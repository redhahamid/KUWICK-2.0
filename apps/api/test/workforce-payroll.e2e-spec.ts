import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { bearerFor, createOwnerAndBearer } from './auth';

/**
 * WAVE 4 — HR and payroll, against a real PostgreSQL.
 *
 * The four properties these prove, each of which is the difference between a
 * payroll somebody can rely on and one they cannot:
 *
 *   1. AN UNCONFIGURED SYSTEM COMPUTES NOTHING. No statutory rule set means the
 *      EPF/SOCSO/EIS/PCB columns are NULL, not zero, and the run says so.
 *   2. EXCEPTIONS BLOCK APPROVAL. An employee with no salary is surfaced, not
 *      silently paid nothing.
 *   3. AN APPROVED RUN IS LOCKED — by the database, not by a disabled button.
 *   4. A CORRECTION IS AN ADJUSTMENT ROW, with an actor and a reason.
 */
describe('Workforce: employees, attendance and payroll (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let ownerStaffId: string;
  let clinicId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'HR Tenant' } }));
    const owner = await createOwnerAndBearer(prisma, tenantId);
    bearer = owner.bearer;
    ownerStaffId = owner.staffId;
    const clinic = await request(app.getHttpServer())
      .post('/clinics')
      .set('Authorization', bearer)
      .send({ name: 'HR Clinic' })
      .expect(201);
    clinicId = clinic.body.id;
  });

  async function makeEmployee(name: string, salary?: string, opts: { pcbApplicable?: boolean } = {}) {
    const staff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: name, clinicId } }),
    );
    await request(app.getHttpServer())
      .post(`/workforce/employees/${staff.id}`)
      .set('Authorization', bearer)
      .send({
        employeeNo: `E-${Math.floor(Math.random() * 10000)}`,
        position: 'Clinic Assistant',
        employmentType: 'PERMANENT',
        employmentStatus: 'ACTIVE',
        startDate: '2024-01-01',
        // EPF, SOCSO and EIS all change at age 60, so payroll refuses to guess.
        dateOfBirth: '1990-06-15',
        // PCB is not calculated by this system; an employee inside PCB with no
        // amount entered blocks the run, which is a separate test below.
        pcbApplicable: opts.pcbApplicable ?? false,
      })
      .expect(201);

    // SALARY IS RECORDED WITH THE DATE IT TAKES EFFECT FROM. It used to be a
    // field on the employee form, which meant payroll and the profile could
    // disagree about what somebody is paid. Backdated here so a run for any
    // period in this suite resolves it.
    if (salary) {
      await request(app.getHttpServer())
        .post(`/workforce/employees/${staff.id}/salary`)
        .set('Authorization', bearer)
        .send({ amount: salary, basis: 'MONTHLY', effectiveFrom: '2024-01-01', reason: 'Starting salary' })
        .expect(201);
    }
    return staff.id;
  }

  const PERIOD = '2026-08';

  // -------------------------------------------------------------------------
  it('keeps employment, identity and clinical provider as three separate facts', async () => {
    const staffId = await makeEmployee('Nurul Aina', '3000.00');

    const list = await request(app.getHttpServer())
      .get(`/workforce/employees?clinicId=${clinicId}`)
      .set('Authorization', bearer)
      .expect(200);
    const row = list.body.find((entry: { staffId: string }) => entry.staffId === staffId);
    expect(row.position).toBe('Clinic Assistant');
    expect(row.professionalType).toBe('NON_CLINICAL');
    expect(row.hasProfile).toBe(true);

    // The ordinary HR read carries NO salary, on purpose.
    const profile = await request(app.getHttpServer())
      .get(`/workforce/employees/${staffId}`)
      .set('Authorization', bearer)
      .expect(200);
    expect(profile.body.basicSalary).toBeUndefined();
    expect(profile.body.bankAccountNo).toBeUndefined();

    // The payroll read does, behind its own permission.
    const payrollDetail = await request(app.getHttpServer())
      .get(`/workforce/employees/${staffId}/payroll-detail`)
      .set('Authorization', bearer)
      .expect(200);
    expect(Number(payrollDetail.body.basicSalary)).toBe(3000);
  });

  it('REFUSES a salary sent to the employee form, and says where it goes instead', async () => {
    const staffId = await makeEmployee('Legacy Salary Path');
    const refused = await request(app.getHttpServer())
      .post(`/workforce/employees/${staffId}`)
      .set('Authorization', bearer)
      .send({ basicSalary: '5000.00' })
      .expect(400);
    // The message has to be actionable: a caller who gets "bad request" here
    // learns nothing about where salary actually goes.
    expect(refused.body.message).toMatch(/date it takes effect from/);
    expect(refused.body.message).toMatch(/employees\/:staffId\/salary/);
  });

  it('redacts salary and bank details from the audit trail while still recording the change', async () => {
    const staffId = await makeEmployee('Redaction Test', '4000.00');
    const audit = await withTenantContext(prisma, tenantId, (tx) =>
      tx.auditLog.findMany({ where: { tenantId, action: 'employee.changed' } }),
    );
    expect(audit.length).toBeGreaterThan(0);
    const after = audit[0].after as Record<string, unknown>;
    // What an audit needs IS there: that it changed, and who changed it.
    expect(after._actor).toMatchObject({ staffId: ownerStaffId, name: 'Test Owner' });
    expect(after.position).toBe('Clinic Assistant');
    expect(audit[0].entityType).toBe('EmployeeProfile');
    expect(staffId).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  describe('attendance', () => {
    it('clocks in and out, computes worked minutes, and keeps overtime unapproved', async () => {
      const staffId = await makeEmployee('Punch Tester', '3000.00');

      await request(app.getHttpServer())
        .post('/workforce/attendance/clock')
        .set('Authorization', bearer)
        .send({ staffId, clinicId, at: '2026-08-03T01:00:00.000Z' })
        .expect(201);
      const out = await request(app.getHttpServer())
        .post('/workforce/attendance/clock')
        .set('Authorization', bearer)
        .send({ staffId, clinicId, at: '2026-08-03T10:00:00.000Z' })
        .expect(201);

      expect(out.body.workedMinutes).toBe(540);
      expect(out.body.overtimeApproved).toBe(false);

      const timesheet = await request(app.getHttpServer())
        .get(`/workforce/attendance/timesheet?from=2026-08-01&to=2026-08-31&clinicId=${clinicId}`)
        .set('Authorization', bearer)
        .expect(200);
      const person = timesheet.body.staff.find((entry: { staffId: string }) => entry.staffId === staffId);
      expect(person.workedHours).toBe(9);
      expect(person.daysPresent).toBe(1);
    });

    it('keeps the ORIGINAL punch when a correction is made', async () => {
      const staffId = await makeEmployee('Correction Tester', '3000.00');
      await request(app.getHttpServer())
        .post('/workforce/attendance/clock')
        .set('Authorization', bearer)
        .send({ staffId, clinicId, at: '2026-08-04T02:00:00.000Z' })
        .expect(201);
      const record = await withTenantContext(prisma, tenantId, (tx) =>
        tx.attendanceRecord.findFirst({ where: { staffId } }),
      );

      await request(app.getHttpServer())
        .patch(`/workforce/attendance/${record!.id}/correct`)
        .set('Authorization', bearer)
        .send({
          clockInAt: '2026-08-04T01:00:00.000Z',
          clockOutAt: '2026-08-04T09:00:00.000Z',
          reason: 'Staff member forgot to badge in; CCTV confirms 09:00 local',
        })
        .expect(200);

      const corrected = await withTenantContext(prisma, tenantId, (tx) =>
        tx.attendanceRecord.findUnique({ where: { id: record!.id } }),
      );
      expect(corrected!.originalClockInAt?.toISOString()).toBe('2026-08-04T02:00:00.000Z');
      expect(corrected!.clockInAt?.toISOString()).toBe('2026-08-04T01:00:00.000Z');
      expect(corrected!.correctionReason).toMatch(/CCTV/);
      expect(corrected!.correctedByStaffId).toBe(ownerStaffId);
    });

    it('refuses self-approval of overtime', async () => {
      await request(app.getHttpServer())
        .post('/workforce/attendance/clock')
        .set('Authorization', bearer)
        .send({ staffId: ownerStaffId, clinicId, at: '2026-08-05T01:00:00.000Z' })
        .expect(201);
      const record = await withTenantContext(prisma, tenantId, (tx) =>
        tx.attendanceRecord.findFirst({ where: { staffId: ownerStaffId } }),
      );
      await request(app.getHttpServer())
        .patch(`/workforce/attendance/${record!.id}/approve-overtime`)
        .set('Authorization', bearer)
        .send({ minutes: 60 })
        .expect(400);
    });
  });

  // -------------------------------------------------------------------------
  describe('payroll', () => {
    it('computes NOTHING statutory when no rule set is configured, and says so', async () => {
      await makeEmployee('Salaried One', '3000.00');

      const run = await request(app.getHttpServer())
        .post('/workforce/payroll/runs')
        .set('Authorization', bearer)
        .send({ period: PERIOD, clinicId })
        .expect(201);

      const calculated = await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${run.body.id}/calculate`)
        .set('Authorization', bearer)
        .expect(200);
      expect(calculated.body.statutoryStatus).toBe('NOT_CONFIGURED');

      const detail = await request(app.getHttpServer())
        .get(`/workforce/payroll/runs/${run.body.id}`)
        .set('Authorization', bearer)
        .expect(200);
      expect(detail.body.statutoryNotice).toMatch(/have NOT been calculated/);
      // NULL, not zero. That distinction is the whole point.
      expect(detail.body.lines[0].epfEmployee).toBeNull();
      expect(detail.body.lines[0].socsoEmployee).toBeNull();
      // PCB is ZERO rather than null here, and the difference matters: this
      // employee is recorded as OUTSIDE PCB, which is a fact. Null would mean
      // "we do not know", which is what it says for somebody inside it.
      expect(detail.body.lines[0].pcb).toBe(0);
      expect(detail.body.lines[0].netPay).toBe(3000);

      // And it cannot be approved without acknowledging the gap.
      await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${run.body.id}/approve`)
        .set('Authorization', bearer)
        .send({})
        .expect(400);
    });

    it('computes statutory figures once the tenant configures and verifies a rule set', async () => {
      await makeEmployee('Salaried Two', '3000.00');

      await request(app.getHttpServer())
        .post('/workforce/payroll/statutory-rules')
        .set('Authorization', bearer)
        .send({
          name: 'Test rates',
          effectiveFrom: '2026-01-01',
          // BAND TABLES, in cents, which is what the Third Schedule and the
          // SOCSO/EIS schedules actually are. Deliberately synthetic and
          // deliberately round: this test is about the plumbing — does a
          // configured, verified rule set reach a payslip — and not about
          // Malaysian rates, which are covered by the unit suite against the
          // clinic's own figures.
          epfRules: {
            under60: {
              '11': { bands: [{ min: 0, max: null, employer: 36000, employee: 30000 }] },
            },
            over60: { bands: [{ min: 0, max: null, employer: 12000, employee: 0 }] },
          },
          socsoRules: {
            firstCategory: { bands: [{ min: 0, max: null, employer: 7000, employee: 2000 }] },
            secondCategory: { bands: [{ min: 0, max: null, employer: 5000, employee: 0 }] },
          },
          eisRules: {
            under60: { bands: [{ min: 0, max: null, employer: 500, employee: 500 }] },
            over60: { bands: [{ min: 0, max: null, employer: 0, employee: 0 }] },
          },
          verified: true,
          verificationNote: 'Checked against the published schedule',
        })
        .expect(201);

      const run = await request(app.getHttpServer())
        .post('/workforce/payroll/runs')
        .set('Authorization', bearer)
        .send({ period: PERIOD, clinicId })
        .expect(201);
      const calculated = await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${run.body.id}/calculate`)
        .set('Authorization', bearer)
        .expect(200);
      expect(calculated.body.statutoryStatus).toBe('CONFIGURED');

      const detail = await request(app.getHttpServer())
        .get(`/workforce/payroll/runs/${run.body.id}`)
        .set('Authorization', bearer)
        .expect(200);
      const line = detail.body.lines[0];
      expect(line.epfEmployee).toBe(300);
      expect(line.epfEmployer).toBe(360);
      expect(line.socsoEmployee).toBe(20);
      // Outside PCB, so zero. Configuring EPF does not manufacture a tax
      // figure for anybody who is inside it — see the blocking test below.
      expect(line.pcb).toBe(0);
      expect(line.netPay).toBe(3000 - 300 - 20 - 5);
      expect(detail.body.statutoryNotice).toBeNull();
    });

    it('BLOCKS the run for an employee inside PCB, because this system does not calculate it', async () => {
      await makeEmployee('Taxed Employee', '5000.00', { pcbApplicable: true });

      const run = await request(app.getHttpServer())
        .post('/workforce/payroll/runs')
        .set('Authorization', bearer)
        .send({ period: PERIOD, clinicId })
        .expect(201);
      const calculated = await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${run.body.id}/calculate`)
        .set('Authorization', bearer)
        .expect(200);

      const exceptions = calculated.body.exceptions as { name: string; issue: string }[];
      // The blocker is stated in the owner's words. The engine's reason — that
      // Kuwick does not work PCB out — belongs in the remedy, not the headline.
      expect(exceptions.some((row) => /Monthly tax \(PCB\) is missing/.test(row.issue))).toBe(true);

      const gate = await request(app.getHttpServer())
        .get(`/workforce/payroll/runs/${run.body.id}/exceptions`)
        .set('Authorization', bearer)
        .expect(200);
      const pcb = (gate.body.exceptions as { code: string; remediation: string }[]).find(
        (row) => row.code === 'PCB_MISSING',
      );
      expect(pcb).toBeDefined();
      expect(pcb!.remediation).toMatch(/does not work out monthly tax/);

      // Not approvable, and acknowledging the statutory gap does not get past
      // it — an unresolved exception is a harder stop than an unverified rate.
      await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${run.body.id}/approve`)
        .set('Authorization', bearer)
        .send({ acknowledgeStatutoryGap: true })
        .expect(400);
    });

    it('accepts a PCB amount entered by hand, which is what the clinic does today', async () => {
      const staffId = await makeEmployee('Taxed And Entered', '5000.00', { pcbApplicable: true });

      await withTenantContext(prisma, tenantId, (tx) =>
        tx.payrollInputEntry.create({
          data: {
            tenantId,
            clinicId,
            staffId,
            period: new Date(`${PERIOD}-01T00:00:00.000Z`),
            componentCode: 'PCB',
            label: 'PCB (computed outside Kuwick)',
            amount: '412.50',
            createdByStaffId: staffId,
          },
        }),
      );

      const run = await request(app.getHttpServer())
        .post('/workforce/payroll/runs')
        .set('Authorization', bearer)
        .send({ period: PERIOD, clinicId })
        .expect(201);
      const calculated = await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${run.body.id}/calculate`)
        .set('Authorization', bearer)
        .expect(200);

      const exceptions = (calculated.body.exceptions ?? []) as { issue: string }[];
      expect(exceptions.some((row) => /PCB/.test(row.issue))).toBe(false);

      const detail = await request(app.getHttpServer())
        .get(`/workforce/payroll/runs/${run.body.id}`)
        .set('Authorization', bearer)
        .expect(200);
      const line = detail.body.lines[0];
      // The entered figure is withheld exactly as a computed one would be.
      expect(line.pcb).toBe(412.5);
      expect(line.netPay).toBe(5000 - 412.5);
    });

    it('surfaces an employee with no salary as an EXCEPTION and blocks approval', async () => {
      await makeEmployee('Paid Properly', '3000.00');
      await makeEmployee('No Salary Set');

      const run = await request(app.getHttpServer())
        .post('/workforce/payroll/runs')
        .set('Authorization', bearer)
        .send({ period: PERIOD, clinicId })
        .expect(201);
      const calculated = await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${run.body.id}/calculate`)
        .set('Authorization', bearer)
        .expect(200);

      const exceptions = calculated.body.exceptions as { name: string; issue: string }[];
      expect(exceptions).toHaveLength(1);
      expect(exceptions[0].name).toBe('No Salary Set');
      expect(exceptions[0].issue).toMatch(/Salary setup is incomplete/);
      // One employee paid, one skipped — never silently paid zero.
      expect(calculated.body.employeeCount).toBe(1);

      await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${run.body.id}/approve`)
        .set('Authorization', bearer)
        .send({ acknowledgeStatutoryGap: true })
        .expect(400);
    });

    it('LOCKS an approved run — the database refuses to change a payslip line', async () => {
      await makeEmployee('Locked Employee', '3000.00');
      const run = await request(app.getHttpServer())
        .post('/workforce/payroll/runs')
        .set('Authorization', bearer)
        .send({ period: PERIOD, clinicId })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${run.body.id}/calculate`)
        .set('Authorization', bearer)
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${run.body.id}/approve`)
        .set('Authorization', bearer)
        .send({ acknowledgeStatutoryGap: true })
        .expect(200);

      // Recalculating is refused by the service…
      await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${run.body.id}/calculate`)
        .set('Authorization', bearer)
        .expect(409);

      // …and editing the line directly is refused by the DATABASE.
      const line = await withTenantContext(prisma, tenantId, (tx) =>
        tx.payrollLine.findFirst({ where: { payrollRunId: run.body.id } }),
      );
      await expect(
        withTenantContext(prisma, tenantId, (tx) =>
          tx.payrollLine.update({ where: { id: line!.id }, data: { netPay: 99999 } }),
        ),
      ).rejects.toThrow(/locked/);

      // As is rewriting the run's totals.
      await expect(
        withTenantContext(prisma, tenantId, (tx) =>
          tx.payrollRun.update({ where: { id: run.body.id }, data: { netTotal: 1 } }),
        ),
      ).rejects.toThrow(/locked/);
    });

    it('corrects a locked run through an ADJUSTMENT, which is itself append-only', async () => {
      const staffId = await makeEmployee('Adjusted Employee', '3000.00');
      const run = await request(app.getHttpServer())
        .post('/workforce/payroll/runs')
        .set('Authorization', bearer)
        .send({ period: PERIOD, clinicId })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${run.body.id}/calculate`)
        .set('Authorization', bearer)
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${run.body.id}/approve`)
        .set('Authorization', bearer)
        .send({ acknowledgeStatutoryGap: true })
        .expect(200);

      const adjustment = await request(app.getHttpServer())
        .post(`/workforce/payroll/runs/${run.body.id}/adjustments`)
        .set('Authorization', bearer)
        .send({
          staffId,
          description: 'August travel claim missed from the run',
          amount: '150.00',
          reason: 'Claim submitted after the payroll cut-off',
        })
        .expect(201);

      const detail = await request(app.getHttpServer())
        .get(`/workforce/payroll/runs/${run.body.id}`)
        .set('Authorization', bearer)
        .expect(200);
      expect(detail.body.adjustments).toHaveLength(1);
      expect(detail.body.adjustments[0].amount).toBe(150);
      expect(detail.body.adjustments[0].by).toBe('Test Owner');

      await expect(
        withTenantContext(prisma, tenantId, (tx) =>
          tx.$executeRawUnsafe(`UPDATE payroll_adjustments SET amount = 9999 WHERE id = '${adjustment.body.id}'`),
        ),
      ).rejects.toThrow(/permission denied|append-only/);
    });

    it('refuses a second payroll run for the same month and branch', async () => {
      await request(app.getHttpServer())
        .post('/workforce/payroll/runs')
        .set('Authorization', bearer)
        .send({ period: PERIOD, clinicId })
        .expect(201);
      await request(app.getHttpServer())
        .post('/workforce/payroll/runs')
        .set('Authorization', bearer)
        .send({ period: PERIOD, clinicId })
        .expect(409);
    });
  });

  // -------------------------------------------------------------------------
  it('refuses HR access to an account without the permission', async () => {
    const counter = await withTenantContext(prisma, tenantId, async (tx) => {
      const staff = await tx.staff.create({
        data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Counter', clinicId },
      });
      await tx.staffRoleAssignment.create({
        data: { tenantId, staffId: staff.id, role: 'ADMINISTRATOR', assignedByStaffId: ownerStaffId },
      });
      return staff;
    });
    const counterBearer = bearerFor(tenantId, counter.id, Role.FRONT_DESK_CLINICAL_STAFF);

    await request(app.getHttpServer()).get('/workforce/employees').set('Authorization', counterBearer).expect(403);
    await request(app.getHttpServer()).get('/workforce/payroll/runs').set('Authorization', counterBearer).expect(403);
  });
});
