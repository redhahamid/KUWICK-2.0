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
 * day worked — and this spec pins that too, because it is the half that IS
 * computed and it would be easy to break while adding the half that is not.
 *
 * What nothing did was say that the annual leave they never took is still owed.
 * A leaver stopped appearing, the month footed correctly without them, and the
 * payout was remembered or it was not. Now the run names them, prints the whole
 * ledger, and BLOCKS until somebody says what happened to it.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO IS VALUE THE DAYS. How s.60E(3) prices
 * untaken leave on a RESIGNATION, and whether days carried forward under clinic
 * policy are worth the same as the Act's own entitlement, are open questions
 * the account holder is checking against another source. A figure guessed here
 * would be money, and it would look right.
 *
 * Aminah joins 1 January 2026 on RM2,600, is entitled to 12 annual days, takes
 * three in March, and leaves on 15 August 2026.
 */
describe('a leaver’s settlement (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;
  let legalEmployerId: string;
  let leaverId: string;

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

  it('names the untaken leave, prints the whole ledger, and blocks the month', async () => {
    const runId = await runFor('2026-08');
    const own = await exceptionsFor(runId, leaverId);
    const leave = own.find((row) => row.code === 'LEAVER_UNTAKEN_LEAVE');

    expect(leave?.severity).toBe('BLOCKING');
    expect(leave?.cause).toContain('Aminah Pergi');
    expect(leave?.cause).toContain('2026-08-15');
    // 12 entitled, 3 taken, 9 left. Every figure the person answering needs.
    expect(leave?.cause).toContain('9 days of annual leave untaken');
    expect(leave?.cause).toContain('12 entitled');
    expect(leave?.cause).toContain('3 taken');
    // Overridable, because the override is the record of what was paid.
    expect(leave?.overridable).toBe(true);
  });

  it('says plainly that the days are counted and not valued', async () => {
    const runId = await runFor('2026-08');
    const own = await exceptionsFor(runId, leaverId);
    const gate = await http().get(`/workforce/payroll/runs/${runId}/exceptions`).set('Authorization', bearer).expect(200);
    const row = (gate.body.exceptions as { code: string; consequence: string; remediation: string }[]).find(
      (entry) => entry.code === 'LEAVER_UNTAKEN_LEAVE',
    );
    expect(own.some((entry) => entry.code === 'LEAVER_UNTAKEN_LEAVE')).toBe(true);
    // The month is right and the leave is not in it: both halves of the
    // sentence, because either one alone misleads.
    expect(row?.consequence).toContain('already cut to the days they served');
    expect(row?.consequence).toContain('Kuwick does not work it out');
    expect(row?.remediation).toContain('payroll input');
  });

  it('says nothing about a month nobody left in', async () => {
    // July: she is still employed, so there is no settlement to raise. The
    // exception must fire once, for the month of the last day, and never on an
    // ordinary month.
    const runId = await runFor('2026-07');
    const own = await exceptionsFor(runId, leaverId);
    expect(own.some((row) => row.code === 'LEAVER_UNTAKEN_LEAVE')).toBe(false);
    expect(await basicFor(runId, leaverId)).toBe(2600);
  });
});
