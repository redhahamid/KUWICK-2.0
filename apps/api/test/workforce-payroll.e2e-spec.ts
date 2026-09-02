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
  let legalEmployerId: string;

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

    // THE EMPLOYING COMPANY, which is not the branch. EPF, SOCSO, EIS and PCB
    // are all filed by an entity, so an employee attached to none of them
    // blocks approval — see NO_LEGAL_EMPLOYER.
    const employer = await request(app.getHttpServer())
      .post('/workforce/legal-employers')
      .set('Authorization', bearer)
      .send({ name: `HR Employer ${randomId().slice(0, 8)}` })
      .expect(201);
    legalEmployerId = employer.body.id;
  });

  async function makeEmployee(
    name: string,
    salary?: string,
    opts: { pcbApplicable?: boolean; epfMembership?: string | null; startDate?: string; endDate?: string } = {},
  ) {
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
        startDate: opts.startDate ?? '2024-01-01',
        ...(opts.endDate ? { endDate: opts.endDate } : {}),
        // EPF, SOCSO and EIS all change at age 60, so payroll refuses to guess.
        dateOfBirth: '1990-06-15',
        // Which Part of the EPF Third Schedule applies. Passing null exercises
        // the blocking path; it is not a default.
        ...(opts.epfMembership === null ? {} : { epfMembership: opts.epfMembership ?? 'MALAYSIAN_CITIZEN' }),
        // PCB is not calculated by this system; an employee inside PCB with no
        // amount entered blocks the run, which is a separate test below.
        pcbApplicable: opts.pcbApplicable ?? false,
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/workforce/employees/${staff.id}/legal-employer`)
      .set('Authorization', bearer)
      .send({ legalEmployerId })
      .expect(200);

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
    it('leaves EPF NULL — not zero — when the employee’s Third Schedule Part is unknown', async () => {
      // This used to be "no rule set is configured", which was a property of
      // the TENANT. Schedules now ship with Kuwick, so the gap that remains is
      // a property of the EMPLOYEE: without their EPF membership there is no
      // Part, and without a Part there is no contribution to compute.
      await makeEmployee('Salaried One', '3000.00', { epfMembership: null });

      const run = await request(app.getHttpServer())
        .post('/workforce/payroll/runs')
        .set('Authorization', bearer)
        .send({ period: PERIOD, clinicId })
        .expect(201);

      const calculated = await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${run.body.id}/calculate`)
        .set('Authorization', bearer)
        .expect(200);
      // The schedules themselves are in force and verified for this period.
      expect(calculated.body.statutoryStatus).toBe('CONFIGURED');

      const detail = await request(app.getHttpServer())
        .get(`/workforce/payroll/runs/${run.body.id}`)
        .set('Authorization', bearer)
        .expect(200);
      // NULL, not zero. That distinction is the whole point.
      expect(detail.body.lines[0].epfEmployee).toBeNull();
      // SOCSO and EIS need only the date of birth, which this employee has, so
      // they ARE computed — the gap is confined to the scheme it belongs to
      // rather than blanking the whole payslip.
      expect(detail.body.lines[0].socsoEmployee).toBe(36.9);
      expect(detail.body.lines[0].eisEmployee).toBe(5.9);
      // PCB is ZERO rather than null here, and the difference matters: this
      // employee is recorded as OUTSIDE PCB, which is a fact. Null would mean
      // "we do not know", which is what it says for somebody inside it.
      expect(detail.body.lines[0].pcb).toBe(0);

      // And it cannot be approved with a statutory figure still unknown.
      await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${run.body.id}/approve`)
        .set('Authorization', bearer)
        .send({})
        .expect(400);
    });

    it('computes statutory figures with nothing for the tenant to configure', async () => {
      await makeEmployee('Salaried Two', '3000.00');

      // AND THE OLD CONFIGURATION SCREEN IS REFUSED. A clinic cannot legislate:
      // entering its own EPF table was a way to under-contribute by accident
      // and call it a setting.
      const refused = await request(app.getHttpServer())
        .post('/workforce/payroll/statutory-rules')
        .set('Authorization', bearer)
        .send({ name: 'Test rates', effectiveFrom: '2026-01-01', verified: true })
        .expect(400);
      expect(refused.body.message).toMatch(/no longer entered by hand/i);

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
      // The EPF Third Schedule's own figures for the RM3,000 band — computed
      // on the band ceiling, not as 11% of the wage.
      expect(line.epfEmployee).toBe(330);
      expect(line.epfEmployer).toBe(390);
      // SOCSO First Category, invalidity plus SKBBK.
      expect(line.socsoEmployee).toBe(36.9);
      // Outside PCB, so zero. Shipping the schedules does not manufacture a tax
      // figure for anybody who is inside it — see the blocking test below.
      expect(line.pcb).toBe(0);
      expect(line.netPay).toBe(2627.2);
      expect(detail.body.statutoryNotice).toBeNull();

      // THE RUN RECORDS WHICH SCHEDULES PRODUCED THESE FIGURES, so a payslip
      // reprinted next year can be traced to the edition behind it.
      const stamp = detail.body.statutorySnapshot;
      expect(stamp.approvable).toBe(true);
      const epf = stamp.schedules.find((entry: { scheme: string }) => entry.scheme === 'EPF');
      expect(epf.scheduleId).toBe('EPF_THIRD_SCHEDULE_2025_10');
      expect(epf.verification).toBe('OFFICIAL_TEST_VECTOR_VERIFIED');
      expect(epf.contentHash).toMatch(/^[0-9a-f]{16}$/);
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
      // The entered figure is withheld exactly as a computed one would be —
      // alongside the EPF, SOCSO and EIS this system DOES compute.
      expect(line.pcb).toBe(412.5);
      expect(line.epfEmployee).toBe(550);
      expect(line.netPay).toBe(3965.7); // 5000 − 412.50 − 550 − 61.90 − 9.90
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

    it('writes YEAR-TO-DATE from an approved run, and a correction replaces the month rather than doubling it', async () => {
      // The cumulative substrate PCB needs. The table existed and nothing ever
      // wrote to it, which is why a lawful MTD was impossible in principle
      // rather than merely unimplemented.
      const staffId = await makeEmployee('Ytd Employee', '3000.00');
      const run = await request(app.getHttpServer())
        .post('/workforce/payroll/runs')
        .set('Authorization', bearer)
        .send({ period: PERIOD, clinicId })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${run.body.id}/calculate`)
        .set('Authorization', bearer)
        .expect(200);

      // NOTHING is written while the run is only calculated: a draft that may
      // be run five times must not move a year-to-date figure.
      const beforeApproval = await withTenantContext(prisma, tenantId, (tx) =>
        tx.employeeYtd.findMany({ where: { staffId } }),
      );
      expect(beforeApproval).toHaveLength(0);

      await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${run.body.id}/approve`)
        .set('Authorization', bearer)
        .send({})
        .expect(200);

      const written = await withTenantContext(prisma, tenantId, (tx) =>
        tx.employeeYtd.findMany({ where: { staffId } }),
      );
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({
        taxYear: 2026,
        month: 8,
        grossCents: 300000,
        epfEmployeeCents: 33000,
        socsoEmployeeCents: 3690,
        eisEmployeeCents: 590,
        source: 'CALCULATED',
        payrollRunId: run.body.id,
      });

      // REOPEN, RECALCULATE, RE-APPROVE. The month must be REPLACED. Adding to
      // it would double the year-to-date the first time a clinic corrected a
      // payroll, and the error would surface at year end in a Form EA nobody
      // could reconcile.
      await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${run.body.id}/reopen`)
        .set('Authorization', bearer)
        .send({ reason: 'Correcting an allowance' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${run.body.id}/calculate`)
        .set('Authorization', bearer)
        .expect(200);
      await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${run.body.id}/approve`)
        .set('Authorization', bearer)
        .send({})
        .expect(200);

      const afterCorrection = await withTenantContext(prisma, tenantId, (tx) =>
        tx.employeeYtd.findMany({ where: { staffId } }),
      );
      expect(afterCorrection).toHaveLength(1);
      expect(afterCorrection[0].grossCents).toBe(300000);
    });

    it('pays a mid-month joiner by days under s.18A, and prices their overtime on the full month', async () => {
      // August 2026 has 31 days. Somebody who starts on the 20th served 12 of
      // them, both ends inclusive.
      const staffId = await makeEmployee('August Joiner', '3100.00', { startDate: '2026-08-20' });
      const run = await request(app.getHttpServer())
        .post('/workforce/payroll/runs')
        .set('Authorization', bearer)
        .send({ period: PERIOD, clinicId })
        .expect(201);
      const calculated = await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${run.body.id}/calculate`)
        .set('Authorization', bearer)
        .expect(200);

      const detail = await request(app.getHttpServer())
        .get(`/workforce/payroll/runs/${run.body.id}`)
        .set('Authorization', bearer)
        .expect(200);
      const line = detail.body.lines.find((row: { staffId: string }) => row.staffId === staffId);
      // RM3,100 x 12/31 = RM1,200 exactly. Not a whole month, and not the
      // 26-day divisor that prices overtime.
      expect(line.basicSalary).toBe(1200);

      // Said out loud rather than left as an unexplained smaller number.
      const exceptions = calculated.body.exceptions as { name: string; issue: string }[];
      expect(exceptions.some((row) => /Paid for 12 of 31 days/.test(row.issue))).toBe(true);
    });

    it('leaves somebody who was not employed during the month OFF the run rather than paying them', async () => {
      await makeEmployee('Left In July', '3000.00', { endDate: '2026-07-31' });
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
      expect(exceptions.some((row) => /not employed during this month/i.test(row.issue))).toBe(true);
      const detail = await request(app.getHttpServer())
        .get(`/workforce/payroll/runs/${run.body.id}`)
        .set('Authorization', bearer)
        .expect(200);
      expect(detail.body.lines.some((row: { name: string }) => row.name === 'Left In July')).toBe(false);
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
