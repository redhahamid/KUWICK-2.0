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
    // HRD Corp registration is a FACT the run now asks for: unrecorded raises
    // a run-level warning. This suite's clinic is below the s.14 headcount and
    // has not opted in, and saying so is the answer that keeps every test here
    // about what it is actually testing.
    await request(app.getHttpServer())
      .post(`/workforce/legal-employers/${legalEmployerId}/statutory-profile`)
      .set('Authorization', bearer)
      .send({ effectiveFrom: '2024-01-01', hrdRegistration: 'NOT_REGISTERED', reason: 'Below the s.14 headcount' })
      .expect(201);

    // THE PAY COMPONENT CATALOGUE. Payroll reads each component's statutory
    // treatment from these effective-dated rows, so a run without them refuses
    // rather than paying money nothing can say the liability of.
    await request(app.getHttpServer())
      .post('/workforce/pay-components/seed')
      .set('Authorization', bearer)
      .expect(201);
  });

  async function makeEmployee(
    name: string,
    salary?: string,
    opts: {
      pcbApplicable?: boolean;
      epfMembership?: string | null;
      startDate?: string;
      endDate?: string;
      taxProfile?: boolean;
      restDayOfWeek?: number | null;
      overtimeContractPolicy?: 'PAY_AT_STATUTORY_RATES' | 'NOT_PAID';
      lindungParticipation?: string | null;
      /** Which company employs them. Defaults to the suite's one employer. */
      legalEmployerId?: string;
      /** `false` records NO statutory classification at all — the run blocks. */
      classification?: boolean;
    } = {},
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
      })
      .expect(201);

    /*
     * STATUTORY CLASSIFICATION IS A DATED RECORD, NOT A FIELD ON THIS FORM.
     *
     * Every one of these used to be a column on the employee profile, so
     * changing an EPF Part in September changed what an unapproved March run
     * computed. Backdated well before every period in this suite so a run for
     * any month resolves exactly one version.
     */
    if (opts.classification !== false)
      await request(app.getHttpServer())
      .post(`/workforce/employees/${staff.id}/statutory-classification`)
      .set('Authorization', bearer)
      .send({
        effectiveFrom: '2020-01-01',
        // Which Part of the EPF Third Schedule applies. Passing null exercises
        // the blocking path; it is not a default.
        ...(opts.epfMembership === null ? {} : { epfMembership: opts.epfMembership ?? 'MALAYSIAN_CITIZEN' }),
        // PCB is not calculated by this system; an employee inside PCB with no
        // amount entered blocks the run, which is a separate test below.
        pcbApplicable: opts.pcbApplicable ?? false,
        // Residence and MTD category. Without both, monthly tax cannot be
        // worked out and the run blocks — which is its own test below.
        ...(opts.taxProfile
          ? { taxResidence: 'RESIDENT', pcbCategory: 'CATEGORY_1', qualifyingChildren: 0 }
          : {}),
        // s.59 rest day. Passing null exercises the blocking path.
        ...(opts.restDayOfWeek === null ? {} : { restDayOfWeek: opts.restDayOfWeek ?? 0 }),
        ...(opts.overtimeContractPolicy ? { overtimeContractPolicy: opts.overtimeContractPolicy } : {}),
        // LINDUNG 24 JAM. Passing null leaves the field blank, which the run
        // reads as enrolled; it is never inferred from anything else here.
        ...(opts.lindungParticipation === null
          ? {}
          : { lindungParticipation: opts.lindungParticipation ?? 'NOT_PARTICIPATING' }),
        reason: 'Recorded at hire',
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/workforce/employees/${staff.id}/legal-employer`)
      .set('Authorization', bearer)
      .send({ legalEmployerId: opts.legalEmployerId ?? legalEmployerId })
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
  describe('statutory classification, with a date on it', () => {
    /*
     * THE DEFECT THIS SUITE GUARDS.
     *
     * Which EPF Third Schedule Part somebody falls under, whether they joined
     * LINDUNG, their MTD category and the rest day their employer designated
     * were plain mutable columns on the employee profile. Editing one changed
     * what EVERY unapproved period computed — recording a permanent residence
     * in September repriced March, silently, with nothing on the payslip
     * saying which standing had been used.
     */

    it('REFUSES a statutory classification sent to the employee form, and says where it goes instead', async () => {
      const staffId = await makeEmployee('Form Writer', '3000.00');
      const refused = await request(app.getHttpServer())
        .post(`/workforce/employees/${staffId}`)
        .set('Authorization', bearer)
        .send({ epfMembership: 'PERMANENT_RESIDENT' })
        .expect(400);
      expect(refused.body.message).toMatch(/statutory-classification/);
      expect(refused.body.message).toMatch(/epfMembership/);
    });

    it('does not reprice an already-calculated month when the standing changes later', async () => {
      // The proof, in money. August is calculated with LINDUNG declined, so
      // nothing is taken. The employee then opts in from 1 September. August
      // recalculated must still take nothing; September must take the
      // contribution. One record, two answers, each true of its own month.
      const staffId = await makeEmployee('Opts In Later', '6000.00', {
        lindungParticipation: 'NOT_PARTICIPATING',
      });

      const august = await request(app.getHttpServer())
        .post('/workforce/payroll/runs')
        .set('Authorization', bearer)
        .send({ period: PERIOD, clinicId })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${august.body.id}/calculate`)
        .set('Authorization', bearer)
        .expect(200);
      const beforeDetail = await request(app.getHttpServer())
        .get(`/workforce/payroll/runs/${august.body.id}`)
        .set('Authorization', bearer)
        .expect(200);
      const beforeLine = beforeDetail.body.lines.find((l: { staffId: string }) => l.staffId === staffId);
      expect(Number(beforeLine.lindungEmployee ?? 0)).toBe(0);

      await request(app.getHttpServer())
        .post(`/workforce/employees/${staffId}/statutory-classification`)
        .set('Authorization', bearer)
        .send({
          effectiveFrom: '2026-09-01',
          lindungParticipation: 'ENROLLED',
          reason: 'Signed up during the September enrolment window',
        })
        .expect(201);

      // AUGUST, RECALCULATED AFTER THE CHANGE. Unmoved.
      await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${august.body.id}/calculate`)
        .set('Authorization', bearer)
        .expect(200);
      const afterDetail = await request(app.getHttpServer())
        .get(`/workforce/payroll/runs/${august.body.id}`)
        .set('Authorization', bearer)
        .expect(200);
      const afterLine = afterDetail.body.lines.find((l: { staffId: string }) => l.staffId === staffId);
      expect(Number(afterLine.lindungEmployee ?? 0)).toBe(0);
      // And the payslip carries the version it was computed on, so the answer
      // is provable from the line rather than from today's employee record.
      expect(afterLine.snapshot.statutoryClassification.lindungParticipation).toBe('NOT_PARTICIPATING');

      // SEPTEMBER takes it.
      const september = await request(app.getHttpServer())
        .post('/workforce/payroll/runs')
        .set('Authorization', bearer)
        .send({ period: '2026-09', clinicId })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${september.body.id}/calculate`)
        .set('Authorization', bearer)
        .expect(200);
      const septDetail = await request(app.getHttpServer())
        .get(`/workforce/payroll/runs/${september.body.id}`)
        .set('Authorization', bearer)
        .expect(200);
      const septLine = septDetail.body.lines.find((l: { staffId: string }) => l.staffId === staffId);
      expect(Number(septLine.lindungEmployee)).toBeGreaterThan(0);
      expect(septLine.snapshot.statutoryClassification.lindungParticipation).toBe('ENROLLED');
    });

    it('BLOCKS the month when the standing changed part-way through it', async () => {
      const staffId = await makeEmployee('Mid Month Change', '6000.00');
      await request(app.getHttpServer())
        .post(`/workforce/employees/${staffId}/statutory-classification`)
        .set('Authorization', bearer)
        .send({ effectiveFrom: '2026-08-15', epfMembership: 'PERMANENT_RESIDENT' })
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
      const exceptions = calculated.body.exceptions as { name: string; issue: string }[];
      expect(exceptions.some((row) => /statutory classification changed on 2026-08-15/.test(row.issue))).toBe(true);
      // The FIELD is named, not merely that something moved.
      expect(exceptions.some((row) => /EPF Third Schedule Part/.test(row.issue))).toBe(true);

      // Left out of the totals rather than paid on a standing nobody chose.
      const detail = await request(app.getHttpServer())
        .get(`/workforce/payroll/runs/${run.body.id}`)
        .set('Authorization', bearer)
        .expect(200);
      expect(detail.body.lines.some((l: { staffId: string }) => l.staffId === staffId)).toBe(false);

      const gate = await request(app.getHttpServer())
        .get(`/workforce/payroll/runs/${run.body.id}/exceptions`)
        .set('Authorization', bearer)
        .expect(200);
      const blocker = (gate.body.exceptions as { code: string; overridable: boolean }[]).find(
        (row) => row.code === 'STATUTORY_CLASSIFICATION_CHANGED_MID_PERIOD',
      );
      expect(blocker).toBeDefined();
      expect(blocker!.overridable).toBe(false);
    });

    it('BLOCKS an employee with no statutory standing on record at all', async () => {
      const staffId = await makeEmployee('Never Classified', '3000.00', { classification: false });
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
      expect(exceptions.some((row) => row.name === 'Never Classified' && /No statutory classification/.test(row.issue))).toBe(
        true,
      );
      const detail = await request(app.getHttpServer())
        .get(`/workforce/payroll/runs/${run.body.id}`)
        .set('Authorization', bearer)
        .expect(200);
      expect(detail.body.lines.some((l: { staffId: string }) => l.staffId === staffId)).toBe(false);
    });

    it('refuses a change dated into a month that has already been approved', async () => {
      const staffId = await makeEmployee('Settled Month', '3000.00');
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
        .send({})
        .expect(200);

      const refused = await request(app.getHttpServer())
        .post(`/workforce/employees/${staffId}/statutory-classification`)
        .set('Authorization', bearer)
        .send({ effectiveFrom: '2026-08-01', epfMembership: 'PERMANENT_RESIDENT' })
        .expect(409);
      expect(refused.body.message).toMatch(/approved payroll run/);
    });

    it('refuses a version that states nothing new', async () => {
      const staffId = await makeEmployee('Same Again', '3000.00');
      const refused = await request(app.getHttpServer())
        .post(`/workforce/employees/${staffId}/statutory-classification`)
        .set('Authorization', bearer)
        .send({ effectiveFrom: '2026-01-01', epfMembership: 'MALAYSIAN_CITIZEN' })
        .expect(400);
      expect(refused.body.message).toMatch(/no new fact to record/);
    });

    it('carries the standing forward, so changing one classification does not blank the rest', async () => {
      const staffId = await makeEmployee('Carry Forward', '3000.00', { taxProfile: true, pcbApplicable: true });
      await request(app.getHttpServer())
        .post(`/workforce/employees/${staffId}/statutory-classification`)
        .set('Authorization', bearer)
        .send({ effectiveFrom: '2026-01-01', qualifyingChildren: 2 })
        .expect(201);

      const history = await request(app.getHttpServer())
        .get(`/workforce/employees/${staffId}/statutory-classification`)
        .set('Authorization', bearer)
        .expect(200);
      const current = history.body.find((row: { current: boolean }) => row.current);
      expect(current.qualifyingChildren).toBe(2);
      // Untouched by this version, and still true.
      expect(current.epfMembership).toBe('MALAYSIAN_CITIZEN');
      expect(current.taxResidence).toBe('RESIDENT');
      expect(current.restDayOfWeek).toBe(0);
      // And the history says exactly what moved.
      expect(current.changed).toEqual(['qualifying children']);
      // The previous version is CLOSED the day before, not deleted.
      const previous = history.body.find((row: { current: boolean }) => !row.current);
      expect(previous.effectiveTo).toBe('2025-12-31');
      expect(previous.qualifyingChildren).toBe(0);
    });

    it('leaves an employee of another company out of the run, and names the company that pays them', async () => {
      // A GROUP RUNNING TWO ENTITIES FROM ONE CLINIC. The run is scoped to an
      // employing company; the calculation used to select on BRANCH alone, so
      // company B's people were computed into company A's run and then had
      // their year-to-date filed under B — one month, two entities.
      const other = await request(app.getHttpServer())
        .post('/workforce/legal-employers')
        .set('Authorization', bearer)
        .send({ name: `Other Employer ${randomId().slice(0, 8)}` })
        .expect(201);
      const outsider = await makeEmployee('Other Company Staff', '3000.00', {
        legalEmployerId: other.body.id,
      });
      await makeEmployee('This Company Staff', '3000.00');

      const run = await request(app.getHttpServer())
        .post('/workforce/payroll/runs')
        .set('Authorization', bearer)
        .send({ period: PERIOD, clinicId, legalEmployerId })
        .expect(201);
      const calculated = await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${run.body.id}/calculate`)
        .set('Authorization', bearer)
        .expect(200);

      const detail = await request(app.getHttpServer())
        .get(`/workforce/payroll/runs/${run.body.id}`)
        .set('Authorization', bearer)
        .expect(200);
      expect(detail.body.lines.some((l: { staffId: string }) => l.staffId === outsider)).toBe(false);
      expect(detail.body.lines).toHaveLength(1);

      // Said out loud. A missing payslip is only safe if somebody can find out
      // which run pays it.
      const exceptions = calculated.body.exceptions as { name: string; issue: string }[];
      expect(
        exceptions.some((row) => row.name === 'Other Company Staff' && /Employed by Other Employer/.test(row.issue)),
      ).toBe(true);
      // INFO — another company's employee is not this run's blocker.
      const gate = await request(app.getHttpServer())
        .get(`/workforce/payroll/runs/${run.body.id}/exceptions`)
        .set('Authorization', bearer)
        .expect(200);
      const row = (gate.body.exceptions as { code: string; severity: string }[]).find(
        (e) => e.code === 'EMPLOYED_BY_ANOTHER_COMPANY',
      );
      expect(row!.severity).toBe('INFO');
    });

    it('names the employing company on the run without being asked, when there is only one', async () => {
      // `PayrollRun.legalEmployerId` scoped every statutory output since Stage 1
      // and NOTHING EVER SET IT: every run was created with it null. A clinic
      // with one company should never meet the concept, so it is derived.
      await makeEmployee('Only Company', '3000.00');
      const run = await request(app.getHttpServer())
        .post('/workforce/payroll/runs')
        .set('Authorization', bearer)
        .send({ period: PERIOD, clinicId })
        .expect(201);
      expect(run.body.legalEmployerId).toBe(legalEmployerId);
    });

    it('REFUSES to guess the employing company when the branch has two', async () => {
      const other = await request(app.getHttpServer())
        .post('/workforce/legal-employers')
        .set('Authorization', bearer)
        .send({ name: `Second Employer ${randomId().slice(0, 8)}` })
        .expect(201);
      await makeEmployee('Company A Staff', '3000.00');
      await makeEmployee('Company B Staff', '3000.00', { legalEmployerId: other.body.id });

      const refused = await request(app.getHttpServer())
        .post('/workforce/payroll/runs')
        .set('Authorization', bearer)
        .send({ period: PERIOD, clinicId })
        .expect(400);
      expect(refused.body.message).toMatch(/2 different companies/);
      // Naming one is accepted.
      await request(app.getHttpServer())
        .post('/workforce/payroll/runs')
        .set('Authorization', bearer)
        .send({ period: PERIOD, clinicId, legalEmployerId })
        .expect(201);
    });

    it('records the employer HRD class as a dated fact, and derives the rate from it', async () => {
      // The old form took a free-text category and a typed rate. Both refused:
      // 1% and 0.5% are the PSMB Act's numbers, and neither was dated.
      const refused = await request(app.getHttpServer())
        .post('/workforce/legal-employers')
        .set('Authorization', bearer)
        .send({ id: legalEmployerId, name: `HRD Typed ${randomId().slice(0, 8)}`, hrdLevyRate: 0.01 })
        .expect(400);
      expect(refused.body.message).toMatch(/statutory-profile/);

      // The rate was a hand-typed decimal beside free text. 1% (s.14) and 0.5%
      // (s.15) are the PSMB Act's numbers, so the class is recorded and the
      // rate follows.
      await request(app.getHttpServer())
        .post(`/workforce/legal-employers/${legalEmployerId}/statutory-profile`)
        .set('Authorization', bearer)
        .send({ effectiveFrom: '2026-01-01', hrdRegistration: 'MANDATORY_SECTION_14' })
        .expect(201);
      const history = await request(app.getHttpServer())
        .get(`/workforce/legal-employers/${legalEmployerId}/statutory-profile`)
        .set('Authorization', bearer)
        .expect(200);
      const current = history.body.find((row: { current: boolean }) => row.current);
      expect(current.hrdRegistration).toBe('MANDATORY_SECTION_14');
      expect(current.hrdLevyRatePercent).toBe(1);

      const resolved = await request(app.getHttpServer())
        .get(`/workforce/legal-employers/${legalEmployerId}/statutory-profile/resolve?period=2026-08-01`)
        .set('Authorization', bearer)
        .expect(200);
      expect(resolved.body.state).toBe('RESOLVED');
      expect(resolved.body.hrdLevyRatePercent).toBe(1);

      // A period before ANY class was recorded resolves to nothing, not to
      // NOT_REGISTERED — "we hold no answer" is not "no levy is due". (The
      // suite's bootstrap records NOT_REGISTERED from 2024, so the truly
      // unrecorded period is earlier still.)
      const earlier = await request(app.getHttpServer())
        .get(`/workforce/legal-employers/${legalEmployerId}/statutory-profile/resolve?period=2023-06-01`)
        .set('Authorization', bearer)
        .expect(200);
      expect(earlier.body.state).toBe('NONE_ON_RECORD');
      expect(earlier.body.hrdLevyRatePercent).toBeNull();
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
      // Act 4 invalidity alone. SKBBK is a separate voluntary scheme and this
      // employee has not joined it.
      expect(detail.body.lines[0].socsoEmployee).toBe(14.75);
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
      // SOCSO First Category — invalidity alone under Act 4.
      expect(line.socsoEmployee).toBe(14.75);
      // Outside PCB, so zero. Shipping the schedules does not manufacture a tax
      // figure for anybody who is inside it — see the blocking test below.
      expect(line.pcb).toBe(0);
      expect(line.netPay).toBe(2649.35); // 3000 − 330 EPF − 14.75 SOCSO − 5.90 EIS
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
      // The remedy leads with the truthful path — complete the tax profile and
      // the figure is calculated; the old text still claimed Kuwick could not.
      expect(pcb!.remediation).toMatch(/calculated from HASiL/);

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
      expect(line.netPay).toBe(4002.85); // 5000 − 412.50 PCB − 550 EPF − 24.75 SOCSO − 9.90 EIS
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
        socsoEmployeeCents: 1475,
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

    it('works monthly tax out for an employee whose tax profile is complete', async () => {
      const staffId = await makeEmployee('Taxpayer', '5000.00', { pcbApplicable: true, taxProfile: true });
      // JANUARY, deliberately. The method projects the rest of the year from
      // what it has seen: an August run for somebody with no year-to-date is
      // an employee who appears to have earned nothing for seven months, and
      // the correct MTD on five months of RM5,000 really is nil. That is the
      // cumulative substrate doing its job, not a bug, and the test below
      // exercises the mid-year case properly.
      const run = await request(app.getHttpServer())
        .post('/workforce/payroll/runs')
        .set('Authorization', bearer)
        .send({ period: '2026-01', clinicId })
        .expect(201);
      const calculated = await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${run.body.id}/calculate`)
        .set('Authorization', bearer)
        .expect(200);

      // No PCB_MISSING blocker any more: the figure is computed, not demanded.
      const exceptions = calculated.body.exceptions as { name: string; issue: string }[];
      expect(exceptions.some((row) => /Monthly tax \(PCB\) is missing/.test(row.issue))).toBe(false);

      const detail = await request(app.getHttpServer())
        .get(`/workforce/payroll/runs/${run.body.id}`)
        .set('Authorization', bearer)
        .expect(200);
      const line = detail.body.lines.find((row: { staffId: string }) => row.staffId === staffId);
      expect(line.pcb).toBeGreaterThan(0);
      expect(line.epfEmployee).toBe(550);

      // And the run can now be approved without acknowledging a statutory gap,
      // which was impossible for anybody inside PCB before this.
      await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${run.body.id}/approve`)
        .set('Authorization', bearer)
        .send({})
        .expect(200);
    });

    it('still BLOCKS an employee inside PCB whose residence and category are unknown', async () => {
      // The fail-safe survives PCB becoming computable. An unknown profile is
      // an unanswerable question, not a nil liability.
      await makeEmployee('Unknown Profile', '5000.00', { pcbApplicable: true });
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
        .expect(400);
    });

    it('carries the year to date into the next month’s tax, from the database', async () => {
      // The method is cumulative, and this is the path that has to prove it.
      // Seven months of history — the mid-year migration case — then August.
      const staffId = await makeEmployee('Cumulative', '5000.00', { pcbApplicable: true, taxProfile: true });
      await request(app.getHttpServer())
        .post('/workforce/payroll/ytd-opening')
        .set('Authorization', bearer)
        .send({
          legalEmployerId,
          source: 'Payslips from the previous system, January to July 2026',
          months: [1, 2, 3, 4, 5, 6, 7].map((month) => ({
            staffId,
            taxYear: 2026,
            month,
            grossCents: 500000,
            additionalRemunerationCents: 0,
            pcbCents: 11000,
            cp38Cents: 0,
            zakatCents: 0,
            epfEmployeeCents: 55000,
            epfEmployerCents: 65000,
            socsoEmployeeCents: 6190,
            socsoEmployerCents: 8665,
            eisEmployeeCents: 990,
            eisEmployerCents: 990,
          })),
        })
        .expect(201);

      const august = await request(app.getHttpServer())
        .post('/workforce/payroll/runs')
        .set('Authorization', bearer)
        .send({ period: PERIOD, clinicId })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${august.body.id}/calculate`)
        .set('Authorization', bearer)
        .expect(200);
      const detail = await request(app.getHttpServer())
        .get(`/workforce/payroll/runs/${august.body.id}`)
        .set('Authorization', bearer)
        .expect(200);
      const line = detail.body.lines.find((row: { staffId: string }) => row.staffId === staffId);
      // With the year behind them, August owes tax. Without the import it
      // would have been nil — which is exactly the error a mid-year migration
      // makes when it starts from zero.
      expect(line.pcb).toBeGreaterThan(0);

      // Approving August adds its own month to the record, alongside the seven
      // that were imported.
      await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${august.body.id}/approve`)
        .set('Authorization', bearer)
        .send({})
        .expect(200);
      const ytd = await request(app.getHttpServer())
        .get(`/workforce/payroll/employees/${staffId}/ytd?year=2026`)
        .set('Authorization', bearer)
        .expect(200);
      expect(ytd.body.months).toHaveLength(8);
      expect(ytd.body.imported).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(ytd.body.months[7]).toMatchObject({ month: 8, source: 'CALCULATED' });
    });

    it('takes OPENING year-to-date for a clinic that starts using Kuwick mid-year', async () => {
      // Without these the rest of the year is computed as though the employee
      // had earned nothing and paid no tax, so PCB charges them from scratch on
      // income they have already been taxed on.
      const staffId = await makeEmployee('Mid Year Joiner', '4000.00');

      const imported = await request(app.getHttpServer())
        .post('/workforce/payroll/ytd-opening')
        .set('Authorization', bearer)
        .send({
          legalEmployerId,
          source: 'Payslips from the previous system, January to July 2026',
          months: [1, 2, 3].map((month) => ({
            staffId,
            taxYear: 2026,
            month,
            grossCents: 400000,
            additionalRemunerationCents: 0,
            pcbCents: 12000,
            cp38Cents: 0,
            zakatCents: 0,
            epfEmployeeCents: 44000,
            epfEmployerCents: 52000,
            socsoEmployeeCents: 4990,
            socsoEmployerCents: 6965,
            eisEmployeeCents: 790,
            eisEmployerCents: 790,
          })),
        })
        .expect(201);
      expect(imported.body).toMatchObject({ employees: 1, months: 3 });

      const ytd = await request(app.getHttpServer())
        .get(`/workforce/payroll/employees/${staffId}/ytd?year=2026`)
        .set('Authorization', bearer)
        .expect(200);
      expect(ytd.body.total).toMatchObject({ grossCents: 1200000, pcbCents: 36000, epfEmployeeCents: 132000 });
      // Which months were typed in and which Kuwick computed. A PCB built on
      // top of an import is only as good as the import, and a screen that
      // cannot tell them apart cannot say so.
      expect(ytd.body.imported).toEqual([1, 2, 3]);
    });

    it('refuses to let an opening balance overwrite a month Kuwick itself paid', async () => {
      const staffId = await makeEmployee('Already Paid', '3000.00');
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
        .send({})
        .expect(200);

      // That month is backed by an approved run, a snapshot and a hash. An
      // import replacing it would make the year-to-date disagree with the
      // payslip the employee is holding.
      const refused = await request(app.getHttpServer())
        .post('/workforce/payroll/ytd-opening')
        .set('Authorization', bearer)
        .send({
          legalEmployerId,
          source: 'A spreadsheet somebody found',
          months: [
            {
              staffId,
              taxYear: 2026,
              month: 8,
              grossCents: 999900,
              additionalRemunerationCents: 0,
              pcbCents: 0,
              cp38Cents: 0,
              zakatCents: 0,
              epfEmployeeCents: 0,
              epfEmployerCents: 0,
              socsoEmployeeCents: 0,
              socsoEmployerCents: 0,
              eisEmployeeCents: 0,
              eisEmployerCents: 0,
            },
          ],
        })
        .expect(409);
      expect(refused.body.message).toMatch(/cannot replace a month this system paid/i);

      // And the run's own figure is untouched.
      const ytd = await request(app.getHttpServer())
        .get(`/workforce/payroll/employees/${staffId}/ytd?year=2026`)
        .set('Authorization', bearer)
        .expect(200);
      expect(ytd.body.total.grossCents).toBe(300000);
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

    it('prices a public holiday at two days and a rest day in days, not as 1.5× overtime', async () => {
      // THE UNDERPAYMENT THIS REPLACES. Every approved minute in the month used
      // to be pooled and paid at 1.5×, so two hours on a public holiday was
      // worth three hours' pay against the two DAYS the Act owes.
      //
      // RM3,120 a month: ORP = 3120/26 = RM120 a day, hourly = 120/7.5 = RM16.
      const staffId = await makeEmployee('Holiday Worker', '3120.00', { restDayOfWeek: 0 });

      await withTenantContext(prisma, tenantId, async (tx) => {
        await tx.publicHoliday.create({
          data: { tenantId, date: new Date('2026-08-31T00:00:00.000Z'), name: 'Hari Kebangsaan' },
        });
        // Two hours on the public holiday…
        await tx.attendanceRecord.create({
          data: {
            tenantId,
            staffId,
            clinicId,
            workDate: new Date('2026-08-31T00:00:00.000Z'),
            status: 'PRESENT',
            workedMinutes: 120,
          },
        });
        // …and a full rest day (Sunday the 16th).
        await tx.attendanceRecord.create({
          data: {
            tenantId,
            staffId,
            clinicId,
            workDate: new Date('2026-08-16T00:00:00.000Z'),
            status: 'PRESENT',
            workedMinutes: 300,
          },
        });
      });

      const run = await request(app.getHttpServer())
        .post('/workforce/payroll/runs')
        .set('Authorization', bearer)
        .send({ period: PERIOD, clinicId })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${run.body.id}/calculate`)
        .set('Authorization', bearer)
        .expect(200);

      const detail = await request(app.getHttpServer())
        .get(`/workforce/payroll/runs/${run.body.id}`)
        .set('Authorization', bearer)
        .expect(200);
      const line = detail.body.lines.find((row: { staffId: string }) => row.staffId === staffId);
      // Public holiday: 2 days × RM120 = RM240. Rest day, 5h of a 7.5h day, so
      // more than half: 1 day × RM120 = RM120. Total RM360.
      //
      // The old engine paid (2h + 5h) × RM16 × 1.5 = RM168 — an underpayment of
      // RM192 on one employee in one month.
      expect(line.overtimePay).toBe(360);
    });

    it('deducts unpaid leave on the month’s own length, not a configured 31', async () => {
      // s.18A covers leave of absence without pay, not only joiners and
      // leavers, so the divisor is the days in THAT wage period. February at a
      // fixed 31 under-deducts by a tenth.
      const staffId = await makeEmployee('February Absentee', '3100.00');
      const leave = await withTenantContext(prisma, tenantId, (tx) =>
        tx.leaveRequest.create({
          data: {
            tenantId,
            staffId,
            leaveType: 'UNPAID',
            startDate: new Date('2026-02-10T00:00:00.000Z'),
            endDate: new Date('2026-02-10T00:00:00.000Z'),
            status: 'APPROVED',
            reason: 'Personal',
          },
        }),
      );
      expect(leave.id).toBeTruthy();

      const run = await request(app.getHttpServer())
        .post('/workforce/payroll/runs')
        .set('Authorization', bearer)
        .send({ period: '2026-02', clinicId })
        .expect(201);
      const calc = await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${run.body.id}/calculate`)
        .set('Authorization', bearer);
      if (calc.status !== 200) throw new Error(`calculate ${calc.status}: ${JSON.stringify(calc.body)}`);
      const detail = await request(app.getHttpServer())
        .get(`/workforce/payroll/runs/${run.body.id}`)
        .set('Authorization', bearer)
        .expect(200);
      const line = detail.body.lines.find((row: { staffId: string }) => row.staffId === staffId);
      // RM3,100 / 28 = RM110.71. The old fixed 31 said RM100.00.
      expect(line.unpaidLeaveDeduction).toBe(110.71);
    });

    it('pays no statutory overtime above the First Schedule limit, and says why', async () => {
      // The Act reaches all employees, but ss.60, 60A and 60D are limited to
      // wages of RM4,000 a month or less. A RM9,000 doctor who works a Sunday
      // has no statutory rest-day entitlement — and inventing one would be as
      // wrong as withholding a benefit they were promised.
      const staffId = await makeEmployee('Senior Doctor', '9000.00', { overtimeContractPolicy: 'NOT_PAID' });
      await withTenantContext(prisma, tenantId, (tx) =>
        tx.attendanceRecord.create({
          data: {
            tenantId,
            staffId,
            clinicId,
            workDate: new Date('2026-08-16T00:00:00.000Z'), // a Sunday
            status: 'PRESENT',
            workedMinutes: 300,
          },
        }),
      );

      const run = await request(app.getHttpServer())
        .post('/workforce/payroll/runs')
        .set('Authorization', bearer)
        .send({ period: PERIOD, clinicId })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${run.body.id}/calculate`)
        .set('Authorization', bearer)
        .expect(200);
      const detail = await request(app.getHttpServer())
        .get(`/workforce/payroll/runs/${run.body.id}`)
        .set('Authorization', bearer)
        .expect(200);
      const line = detail.body.lines.find((row: { staffId: string }) => row.staffId === staffId);
      expect(line.overtimePay).toBe(0);
    });

    it('pays the same money as a COMPANY BENEFIT when the employer undertook to', async () => {
      const staffId = await makeEmployee('Senior With Benefit', '9000.00', {
        overtimeContractPolicy: 'PAY_AT_STATUTORY_RATES',
      });
      await withTenantContext(prisma, tenantId, (tx) =>
        tx.attendanceRecord.create({
          data: {
            tenantId,
            staffId,
            clinicId,
            workDate: new Date('2026-08-16T00:00:00.000Z'),
            status: 'PRESENT',
            workedMinutes: 300,
          },
        }),
      );

      const run = await request(app.getHttpServer())
        .post('/workforce/payroll/runs')
        .set('Authorization', bearer)
        .send({ period: PERIOD, clinicId })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${run.body.id}/calculate`)
        .set('Authorization', bearer)
        .expect(200);
      const detail = await request(app.getHttpServer())
        .get(`/workforce/payroll/runs/${run.body.id}`)
        .set('Authorization', bearer)
        .expect(200);
      const line = detail.body.lines.find((row: { staffId: string }) => row.staffId === staffId);
      // RM9,000 / 26 = RM346.15 for the day.
      expect(line.overtimePay).toBe(346.15);
      // And the payslip says it is a benefit, not an entitlement.
      const entry = detail.body.lines
        .find((row: { staffId: string }) => row.staffId === staffId)
        .breakdown.provenance.find((row: { component: string }) => row.component === 'OVERTIME');
      expect(entry.explanation).toMatch(/Company benefit/);
      expect(entry.explanation).toMatch(/outside the First Schedule limit/);
    });

    it('BLOCKS an above-threshold employee when nobody recorded what they are owed', async () => {
      // Not because they are owed something — they may not be. Because nobody
      // has decided, and paying nil by default is as much a decision as paying
      // 1.5×.
      const staffId = await makeEmployee('Undecided Senior', '9000.00');
      await withTenantContext(prisma, tenantId, (tx) =>
        tx.attendanceRecord.create({
          data: {
            tenantId,
            staffId,
            clinicId,
            workDate: new Date('2026-08-12T00:00:00.000Z'),
            status: 'PRESENT',
            workedMinutes: 450,
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
      const exceptions = calculated.body.exceptions as { name: string; issue: string }[];
      expect(exceptions.some((row) => /overtime provisions do not reach them/.test(row.issue))).toBe(true);
      await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${run.body.id}/approve`)
        .set('Authorization', bearer)
        .send({ acknowledgeStatutoryGap: true })
        .expect(400);
    });

    it('BLOCKS somebody who worked when no rest day is designated for them', async () => {
      // Without the designation a rest day cannot be told from an ordinary
      // working day, and pricing it as ordinary underpays. s.59 makes it the
      // employer's to designate, so it is asked for rather than assumed.
      const staffId = await makeEmployee('No Rest Day', '3120.00', { restDayOfWeek: null });
      await withTenantContext(prisma, tenantId, (tx) =>
        tx.attendanceRecord.create({
          data: {
            tenantId,
            staffId,
            clinicId,
            workDate: new Date('2026-08-12T00:00:00.000Z'),
            status: 'PRESENT',
            workedMinutes: 450,
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
      const exceptions = calculated.body.exceptions as { name: string; issue: string }[];
      expect(exceptions.some((row) => /No rest day is designated/.test(row.issue))).toBe(true);

      await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${run.body.id}/approve`)
        .set('Authorization', bearer)
        .send({ acknowledgeStatutoryGap: true })
        .expect(400);
    });

    it('refuses to run at all when no pay component catalogue covers the period', async () => {
      // THE DEFECT THIS GUARDS. Payroll used to read a hardcoded map of
      // component treatments, so it would happily pay an allowance with no
      // catalogue row behind it — silently EPF-exempt, silently untaxed,
      // configurable nowhere. It now reads the clinic's own effective-dated
      // rows, and no rows means no run.
      await makeEmployee('No Catalogue', '3000.00');
      await withTenantContext(prisma, tenantId, (tx) => tx.payComponent.deleteMany({}));

      const run = await request(app.getHttpServer())
        .post('/workforce/payroll/runs')
        .set('Authorization', bearer)
        .send({ period: PERIOD, clinicId })
        .expect(201);
      const refused = await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${run.body.id}/calculate`)
        .set('Authorization', bearer)
        .expect(400);
      expect(refused.body.message).toMatch(/No pay components are configured/);
    });

    it('takes a component’s statutory treatment from the CATALOGUE, not from the engine', async () => {
      // The proof that the clinic's configuration actually drives the payslip.
      // Mark the standard allowance EPF-exempt from this period and the EPF
      // figure has to move; under the hardcoded map it could not.
      const staffId = await makeEmployee('Allowance Earner', '3000.00');
      await withTenantContext(prisma, tenantId, (tx) =>
        tx.payComponent.updateMany({ where: { code: 'ALLOWANCE' }, data: { epfLiable: false } }),
      );
      await request(app.getHttpServer())
        .post('/workforce/payroll/inputs')
        .set('Authorization', bearer)
        .send({ staffId, period: PERIOD, componentCode: 'ALLOWANCE', amount: '500.00', label: 'Fixed allowance' })
        .expect(201);

      const run = await request(app.getHttpServer())
        .post('/workforce/payroll/runs')
        .set('Authorization', bearer)
        .send({ period: PERIOD, clinicId })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${run.body.id}/calculate`)
        .set('Authorization', bearer)
        .expect(200);
      const detail = await request(app.getHttpServer())
        .get(`/workforce/payroll/runs/${run.body.id}`)
        .set('Authorization', bearer)
        .expect(200);
      const line = detail.body.lines.find((row: { staffId: string }) => row.staffId === staffId);
      // EPF wages are RM3,000, not RM3,500: the allowance is out of the base
      // because the CATALOGUE says so.
      expect(line.epfEmployee).toBe(330);
      // And it is still in gross, and still taxed.
      expect(line.grossPay).toBe(3500);
    });

    it('takes nothing for LINDUNG from a local who has not joined it', async () => {
      // THE OVER-DEDUCTION THIS FIXES. SKBBK was read as an Act 4 column and
      // added to every employee's SOCSO deduction, so a RM6,000 local who never
      // joined a voluntary scheme lost RM44.65 a month to it.
      const staffId = await makeEmployee('Declined Lindung', '6000.00', { lindungParticipation: 'NOT_PARTICIPATING' });
      const run = await request(app.getHttpServer())
        .post('/workforce/payroll/runs')
        .set('Authorization', bearer)
        .send({ period: PERIOD, clinicId })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${run.body.id}/calculate`)
        .set('Authorization', bearer)
        .expect(200);
      const detail = await request(app.getHttpServer())
        .get(`/workforce/payroll/runs/${run.body.id}`)
        .set('Authorization', bearer)
        .expect(200);
      const line = detail.body.lines.find((row: { staffId: string }) => row.staffId === staffId);
      expect(line.lindungEmployee).toBe(0);
      // And SOCSO is the Act 4 figure alone — the invalidity share the clinic's
      // own workbook has always shown.
      expect(line.socsoEmployee).toBe(29.75);
      expect(line.socsoEmployer).toBe(104.15);
    });

    it('takes it from a foreign worker, for whom it is mandatory, with no employer share', async () => {
      const staffId = await makeEmployee('Foreign Worker', '6000.00', {
        lindungParticipation: 'MANDATORY_FOREIGN_WORKER',
      });
      const run = await request(app.getHttpServer())
        .post('/workforce/payroll/runs')
        .set('Authorization', bearer)
        .send({ period: PERIOD, clinicId })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`/workforce/payroll/runs/${run.body.id}/calculate`)
        .set('Authorization', bearer)
        .expect(200);
      const detail = await request(app.getHttpServer())
        .get(`/workforce/payroll/runs/${run.body.id}`)
        .set('Authorization', bearer)
        .expect(200);
      const line = detail.body.lines.find((row: { staffId: string }) => row.staffId === staffId);
      expect(line.lindungEmployee).toBe(44.65);
      // Act 4 is untouched by it, and the employer bears none of it.
      expect(line.socsoEmployee).toBe(29.75);
      expect(line.socsoEmployer).toBe(104.15);
      expect(line.breakdown.statutoryNotes.lindung).toMatch(/mandatory for foreign workers/i);
      expect(line.breakdown.statutoryNotes.lindung).toMatch(/remitted by the employer/i);
    });

    it('treats an unrecorded participation as enrolled, deducts it, and does not block the month', async () => {
      // PERKESO enrols every employee unless they opt out through its own
      // form, so "nobody asked" is the default answer: in. The run used to
      // refuse the month on a blank; the owner decided otherwise.
      const staffId = await makeEmployee('Unrecorded Lindung', '6000.00', { lindungParticipation: null });
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
      expect(exceptions.some((row) => /LINDUNG/i.test(row.issue))).toBe(false);
      const detail = await request(app.getHttpServer())
        .get(`/workforce/payroll/runs/${run.body.id}`)
        .set('Authorization', bearer)
        .expect(200);
      const line = detail.body.lines.find((row: { staffId: string }) => row.staffId === staffId);
      expect(line.lindungEmployee).toBe(44.65);
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
