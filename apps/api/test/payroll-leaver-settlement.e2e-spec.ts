import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();

/**
 * A LEAVER'S UNTAKEN ANNUAL LEAVE IS A DEBT, AND NOTHING SAID SO.
 *
 * The part-month was never the gap. `prorationFor` has cut a leaver's last
 * month to the days actually served since it was written, inclusive of the last
 * day worked — and this spec pins that too, because it is the half that was
 * always computed and it would be easy to break while adding the half that was
 * not.
 *
 * WHAT THE DAYS ARE WORTH IS NOW COMPUTED, and the reading it rests on came
 * from the account holder against the Act's own text: s.60E(3) owes the
 * ordinary rate of pay for every untaken day where EITHER PARTY ends the
 * contract, so a resignation is covered exactly as a dismissal. A clinic whose
 * staff all resign is not outside it.
 *
 * The clinic may still decide not to pay it. That decision is stored rather
 * than refused — the same posture as a below-Act overtime multiplier — and
 * every run then names the leaver and the amount that was not paid.
 *
 * Aminah joins 1 January 2026 on RM2,600, is entitled to 12 annual days, takes
 * three in March, and leaves on 15 August 2026. Nine days at RM2,600 / 26 =
 * RM100 a day is RM900, and every figure in this spec is checkable by hand.
 */
describe('a leaver’s settlement (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;
  let legalEmployerId: string;
  let leaverId: string;
  let withholdingLeaverId: string;
  let orphanId: string;

  const http = () => request(app.getHttpServer());

  const employ = async (staffId: string, employeeNo: string, salary: string, endDate?: string) => {
    await http()
      .post(`/workforce/employees/${staffId}`)
      .set('Authorization', bearer)
      .send({
        employeeNo,
        position: 'Clinic assistant',
        employmentType: 'PERMANENT',
        employmentStatus: 'ACTIVE',
        startDate: '2026-01-01',
        dateOfBirth: '1992-03-03',
        bankName: 'Maybank',
        bankAccountNo: '512345678901',
        ...(endDate ? { endDate } : {}),
      })
      .expect(201);
    await http()
      .post(`/workforce/employees/${staffId}/statutory-classification`)
      .set('Authorization', bearer)
      .send({
        effectiveFrom: '2026-01-01',
        epfMembership: 'MALAYSIAN_CITIZEN',
        taxResidence: 'RESIDENT',
        pcbCategory: 'CATEGORY_1',
        qualifyingChildren: 0,
        restDayOfWeek: 0,
        lindungParticipation: 'NOT_PARTICIPATING',
        reason: 'Recorded at hire',
      })
      .expect(201);
    await http()
      .patch(`/workforce/employees/${staffId}/legal-employer`)
      .set('Authorization', bearer)
      .send({ legalEmployerId })
      .expect(200);
    await http()
      .post(`/workforce/employees/${staffId}/salary`)
      .set('Authorization', bearer)
      .send({ amount: salary, basis: 'MONTHLY', effectiveFrom: '2026-01-01', reason: 'Starting salary' })
      .expect(201);
  };

  const calculate = async (period: string) => {
    const runId = (
      await http().post('/workforce/payroll/runs').set('Authorization', bearer).send({ period, clinicId }).expect(201)
    ).body.id;
    await http().patch(`/workforce/payroll/runs/${runId}/calculate`).set('Authorization', bearer).expect(200);
    return runId;
  };

  const exceptionsFor = async (runId: string, staffId: string) => {
    const gate = await http().get(`/workforce/payroll/runs/${runId}/exceptions`).set('Authorization', bearer).expect(200);
    return (gate.body.exceptions as { code: string; severity: string; staffId: string | null; cause: string; overridable: boolean }[]).filter(
      (row) => row.staffId === staffId,
    );
  };

  const basicFor = async (runId: string, staffId: string) => {
    const detail = await http().get(`/workforce/payroll/runs/${runId}`).set('Authorization', bearer).expect(200);
    const line = (detail.body.lines as { staffId: string; basicSalary: number | string }[]).find((row) => row.staffId === staffId);
    return line === undefined ? null : Number(line.basicSalary);
  };

  // One run per period. Creating a second for the same month is a different
  // conversation (a correction run), and not this spec's subject.
  const runs = new Map<string, string>();
  const runFor = async (period: string) => {
    const existing = runs.get(period);
    if (existing) return existing;
    const runId = await calculate(period);
    runs.set(period, runId);
    return runId;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'Leaver Tenant' } }));
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    clinicId = (await http().post('/clinics').set('Authorization', bearer).send({ name: 'Leaver Clinic' }).expect(201)).body.id;
    legalEmployerId = (
      await http().post('/workforce/legal-employers').set('Authorization', bearer).send({ name: 'Leaver Sdn Bhd' }).expect(201)
    ).body.id;
    await http().post('/workforce/pay-components/seed').set('Authorization', bearer).expect(201);

    const leaver = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Aminah Pergi', clinicId } }),
    );
    leaverId = leaver.id;
    await employ(leaverId, 'L-001', '2600.00', '2026-08-15');

    // Twelve annual days, three taken in March. Not pro-rated on join: she
    // started on 1 January, so the full year is hers either way, and pinning it
    // off keeps the arithmetic in this spec checkable by hand.
    await withTenantContext(prisma, tenantId, async (tx) => {
      const policy = await tx.leavePolicy.create({
        data: { tenantId, name: 'Clinic staff', proRateOnJoin: false, carryForwardDays: 5 },
      });
      await tx.leavePolicyEntitlement.create({
        data: { tenantId, leavePolicyId: policy.id, leaveType: 'ANNUAL', daysPerYear: 12, paid: true },
      });
      await tx.employeeProfile.update({ where: { staffId: leaverId }, data: { leavePolicyId: policy.id } });
      await tx.leaveRequest.create({
        data: {
          tenantId,
          staffId: leaverId,
          leaveType: 'ANNUAL',
          startDate: new Date('2026-03-02T00:00:00.000Z'),
          endDate: new Date('2026-03-04T00:00:00.000Z'),
          status: 'APPROVED',
          reason: 'Balik kampung',
        },
      });
    });

    /*
     * The other two leavers, created here rather than in their own describes:
     * `runFor` memoises one run per month, and the first test calculates it, so
     * anybody who has to appear in August has to exist before then.
     */
    const rosli = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Rosli Tinggal', clinicId } }),
    );
    withholdingLeaverId = rosli.id;
    await employ(withholdingLeaverId, 'L-002', '2600.00', '2026-08-15');
    await withTenantContext(prisma, tenantId, async (tx) => {
      const policy = await tx.leavePolicy.create({
        data: {
          tenantId,
          name: 'Clinic staff (no payout)',
          proRateOnJoin: false,
          carryForwardDays: 3,
          payUntakenLeaveOnExit: false,
          notPayingReason: 'Clinic practice since 2019',
          notPayingAcknowledgedAt: new Date('2026-01-05T00:00:00.000Z'),
        },
      });
      await tx.leavePolicyEntitlement.create({
        data: { tenantId, leavePolicyId: policy.id, leaveType: 'ANNUAL', daysPerYear: 12, paid: true },
      });
      await tx.employeeProfile.update({ where: { staffId: withholdingLeaverId }, data: { leavePolicyId: policy.id } });
    });

    const siti = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Siti Tiada', clinicId } }),
    );
    orphanId = siti.id;
    await employ(orphanId, 'L-003', '2600.00', '2026-08-15');
    // No policy, but somebody keyed a balance by hand, which is the only way
    // days exist at all without one. A new record is now put on the clinic's
    // policy (new-clinic UAT #2), so this is somebody on file from before.
    await withTenantContext(prisma, tenantId, (tx) => tx.employeeProfile.update({ where: { staffId: orphanId }, data: { leavePolicyId: null } }));
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.leaveBalance.create({
        data: { tenantId, staffId: orphanId, leaveType: 'ANNUAL', benefitYear: 2026, entitledDays: 6, carriedInDays: 0, adjustmentDays: 0 },
      }),
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('cuts the last month to the days actually served, inclusive of the last day', async () => {
    // 15 of August's 31 days. RM2,600 x 15 / 31 = RM1,258.06. Counting the last
    // day worked as served is what stops every leaver losing exactly one day.
    const runId = await runFor('2026-08');
    expect(await basicFor(runId, leaverId)).toBe(1258.06);
  });

  it('names the untaken leave, values it at the ordinary rate, and prints the ledger', async () => {
    const runId = await runFor('2026-08');
    const own = await exceptionsFor(runId, leaverId);
    const leave = own.find((row) => row.code === 'LEAVER_LEAVE_PAYOUT_DUE');

    expect(leave?.cause).toContain('Aminah Pergi');
    expect(leave?.cause).toContain('2026-08-15');
    // 12 entitled, 3 taken, 9 left, at RM2,600 / 26 = RM100 a day.
    expect(leave?.cause).toContain('9 days of annual leave untaken');
    expect(leave?.cause).toContain('900.00');
    expect(leave?.cause).toContain('100.00');
  });

  it('does not block the month, because nothing about it is wrong', async () => {
    // The clinic pays it. There is no decision left to take and no error to
    // correct, so the run says the figure and gets out of the way.
    const runId = await runFor('2026-08');
    const own = await exceptionsFor(runId, leaverId);
    const leave = own.find((row) => row.code === 'LEAVER_LEAVE_PAYOUT_DUE');
    expect(leave?.severity).toBe('INFO');
    expect(leave?.overridable).toBe(false);
  });

  it('says it is owed on a resignation, and names the component it is paid under', async () => {
    const runId = await runFor('2026-08');
    const gate = await http().get(`/workforce/payroll/runs/${runId}/exceptions`).set('Authorization', bearer).expect(200);
    const row = (gate.body.exceptions as { code: string; consequence: string; remediation: string }[]).find(
      (entry) => entry.code === 'LEAVER_LEAVE_PAYOUT_DUE',
    );
    // The half of s.60E(3) a clinic whose staff resign would otherwise assume
    // does not apply to it.
    expect(row?.consequence).toContain('resignation as much as on a dismissal');
    /*
     * AND WHY THE RUN NAMES IT RATHER THAN ADDING IT.
     *
     * Not because the statutory treatment is unknown — that is settled now, as
     * a preset with four switches the clinic owns. Because a final payslip is
     * the one nobody gets a second chance to query, so the amount is entered by
     * a person who looked at it.
     */
    expect(row?.consequence).toContain('NOT added to this payslip on its own');
    expect(row?.remediation).toContain('Untaken annual leave paid out');
  });

  it('says nothing about a month nobody left in', async () => {
    // July: she is still employed, so there is no settlement to raise. The
    // exception must fire once, for the month of the last day, and never on an
    // ordinary month.
    const runId = await runFor('2026-07');
    const own = await exceptionsFor(runId, leaverId);
    expect(own.some((row) => row.code.startsWith('LEAVER_'))).toBe(false);
    expect(await basicFor(runId, leaverId)).toBe(2600);
  });

  /**
   * THE CLINIC THAT CHOOSES NOT TO PAY IT.
   *
   * Which is this clinic's actual practice, and the reason the choice exists at
   * all. Kuwick stores it, marks it, and then names the amount withheld on
   * every run — the same three things it does for a below-Act multiplier.
   */
  describe('when the leave policy does not pay it out', () => {
    it('warns with the amount and names the policy that withholds it', async () => {
      const runId = await runFor('2026-08');
      const own = await exceptionsFor(runId, withholdingLeaverId);
      const leave = own.find((row) => row.code === 'LEAVER_LEAVE_PAYOUT_WITHHELD');

      expect(leave?.severity).toBe('WARNING');
      expect(leave?.cause).toContain('Rosli Tinggal');
      // Twelve entitled, none taken, at RM100 a day.
      expect(leave?.cause).toContain('12 days of annual leave untaken');
      expect(leave?.cause).toContain('1200.00');
      expect(leave?.cause).toContain('Clinic staff (no payout)');
      // Nothing to override: the clinic already decided, on the record.
      expect(leave?.overridable).toBe(false);
    });

    it('does not stop the month, and says what the decision costs this person', async () => {
      const runId = await runFor('2026-08');
      const gate = await http().get(`/workforce/payroll/runs/${runId}/exceptions`).set('Authorization', bearer).expect(200);
      const row = (gate.body.exceptions as { code: string; consequence: string; remediation: string }[]).find(
        (entry) => entry.code === 'LEAVER_LEAVE_PAYOUT_WITHHELD',
      );
      expect(row?.consequence).toContain('either party ends the contract');
      expect(row?.consequence).toContain('less than the Act requires');
      expect(row?.remediation).toContain('Nothing is required to finish this run');
    });
  });

  /**
   * NOBODY ASSIGNED THEM A POLICY, so neither the entitlement rule nor the
   * clinic's decision about paying it out is on file. That is the one case that
   * still stops the month.
   */
  describe('when no leave policy is assigned', () => {
    it('blocks the month and stays overridable, because the override is the record', async () => {
      const runId = await runFor('2026-08');
      const own = await exceptionsFor(runId, orphanId);
      const leave = own.find((row) => row.code === 'LEAVER_UNTAKEN_LEAVE');

      expect(leave?.severity).toBe('BLOCKING');
      expect(leave?.cause).toContain('Siti Tiada');
      expect(leave?.cause).toContain('no leave policy is assigned');
      expect(leave?.overridable).toBe(true);
    });
  });
});
