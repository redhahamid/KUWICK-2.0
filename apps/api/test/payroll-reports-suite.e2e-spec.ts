import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { bearerFor, createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();

/**
 * THE REPORTS SUITE AND THE FINANCE CONTRACT — one month, read thirteen ways.
 *
 * One July payroll: Amira works her rest day, takes a day of unpaid leave and
 * earns an incentive and a bonus; Hana has no tax profile, so her PCB is
 * entered by hand. The run is calculated, corrected once, paid, and filed —
 * and every report is asserted against the run's OWN figures, because a
 * report is a view of the record, not a second calculation.
 *
 * The finance contract is the boundary case: a finance clerk with NO HR
 * permission reads the approved liabilities and payment state — aggregates
 * only, from the verified snapshot — while the same clerk is refused the
 * per-employee reports and an HR clerk is refused the contract.
 */
describe('Payroll reports and finance contract (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;
  let legalEmployerId: string;
  let amiraId: string;
  let hanaId: string;
  let runId: string;
  let financeBearer: string;
  let hrClerkBearer: string;

  const server = () => app.getHttpServer();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, name: 'Reports Tenant' } }),
    );
    const owner = await createOwnerAndBearer(prisma, tenantId);
    bearer = owner.bearer;

    const clinic = await request(server())
      .post('/clinics')
      .set('Authorization', bearer)
      .send({ name: 'Reports Clinic' })
      .expect(201);
    clinicId = clinic.body.id;

    const employer = await request(server())
      .post('/workforce/legal-employers')
      .set('Authorization', bearer)
      .send({ name: 'Reports Employer Sdn Bhd' })
      .expect(201);
    legalEmployerId = employer.body.id;
    await request(server())
      .post(`/workforce/legal-employers/${legalEmployerId}/statutory-profile`)
      .set('Authorization', bearer)
      .send({ effectiveFrom: '2024-01-01', hrdRegistration: 'NOT_REGISTERED', reason: 'Below headcount' })
      .expect(201);

    await request(server()).post('/workforce/pay-components/seed').set('Authorization', bearer).expect(201);

    // The two permission-boundary actors: a finance clerk (finance.view, no
    // hr.*) and an HR clerk (hr.view, no finance.view, no reports export).
    const financeClerk = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.FINANCE_STAFF, fullName: 'Finance Clerk', clinicId } }),
    );
    financeBearer = bearerFor(tenantId, financeClerk.id, Role.FINANCE_STAFF);
    const hrClerk = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.HR_STAFF, fullName: 'HR Clerk', clinicId } }),
    );
    hrClerkBearer = bearerFor(tenantId, hrClerk.id, Role.HR_STAFF);

    amiraId = await makeEmployee('Amira Reports', '6000.00', {
      taxProfile: true,
      lindungParticipation: 'ENROLLED',
    });
    hanaId = await makeEmployee('Hana Reports', '4500.00', {
      taxProfile: false,
      lindungParticipation: 'NOT_PARTICIPATING',
    });

    await withTenantContext(prisma, tenantId, async (tx) => {
      // Amira works five hours of her Sunday rest day (2026-07-05)…
      await tx.attendanceRecord.create({
        data: {
          tenantId,
          staffId: amiraId,
          clinicId,
          workDate: new Date('2026-07-05T00:00:00.000Z'),
          status: 'PRESENT',
          workedMinutes: 300,
        },
      });
      // …and takes one day of unpaid leave.
      await tx.leaveRequest.create({
        data: {
          tenantId,
          staffId: amiraId,
          leaveType: 'UNPAID',
          startDate: new Date('2026-07-10T00:00:00.000Z'),
          endDate: new Date('2026-07-10T00:00:00.000Z'),
          status: 'APPROVED',
          reason: 'Personal',
        },
      });
    });

    for (const [code, amount, label] of [
      ['INCENTIVE', '400.00', 'July target incentive'],
      ['BONUS', '1000.00', 'Mid-year bonus'],
    ] as const) {
      await request(server())
        .post('/workforce/payroll/inputs')
        .set('Authorization', bearer)
        .send({ staffId: amiraId, period: '2026-07-01', componentCode: code, amount, label })
        .expect(201);
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  async function makeEmployee(
    name: string,
    salary: string,
    opts: { taxProfile: boolean; lindungParticipation: string; startDate?: string; clinicId?: string },
  ): Promise<string> {
    const startDate = opts.startDate ?? '2024-01-01';
    const staff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({
        data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: name, clinicId: opts.clinicId ?? clinicId },
      }),
    );
    await request(server())
      .post(`/workforce/employees/${staff.id}`)
      .set('Authorization', bearer)
      .send({
        employeeNo: `R-${Math.floor(Math.random() * 100000)}`,
        position: 'Clinic Assistant',
        employmentType: 'PERMANENT',
        employmentStatus: 'ACTIVE',
        startDate,
        dateOfBirth: '1991-03-03',
        bankName: 'Maybank',
        bankAccountNo: '514499887766',
        epfNumber: '00000003',
        taxNumber: 'SG 0000000003',
      })
      .expect(201);
    await request(server())
      .post(`/workforce/employees/${staff.id}/statutory-classification`)
      .set('Authorization', bearer)
      .send({
        effectiveFrom: startDate,
        epfMembership: 'MALAYSIAN_CITIZEN',
        ...(opts.taxProfile ? { taxResidence: 'RESIDENT', pcbCategory: 'CATEGORY_1', qualifyingChildren: 0 } : {}),
        restDayOfWeek: 0,
        lindungParticipation: opts.lindungParticipation,
        // Wages above the First Schedule limit fall outside the Act's own
        // overtime provisions, so whether the company pays anyway has to be
        // RECORDED — otherwise the run raises OVERTIME_ENTITLEMENT_UNRECORDED.
        overtimeContractPolicy: 'PAY_AT_STATUTORY_RATES',
        reason: 'Recorded at hire',
      })
      .expect(201);
    await request(server())
      .patch(`/workforce/employees/${staff.id}/legal-employer`)
      .set('Authorization', bearer)
      .send({ legalEmployerId })
      .expect(200);
    await request(server())
      .post(`/workforce/employees/${staff.id}/salary`)
      .set('Authorization', bearer)
      .send({ amount: salary, basis: 'MONTHLY', effectiveFrom: startDate, reason: 'Starting salary' })
      .expect(201);
    return staff.id;
  }

  async function lineFor(staffId: string) {
    const detail = await request(server())
      .get(`/workforce/payroll/runs/${runId}`)
      .set('Authorization', bearer)
      .expect(200);
    return detail.body.lines.find((line: { staffId: string }) => line.staffId === staffId);
  }

  it('the catalogue lists thirteen reports and names the two honest absences', async () => {
    const res = await request(server()).get('/workforce/payroll/reports').set('Authorization', bearer).expect(200);
    const keys = res.body.available.map((entry: { key: string }) => entry.key);
    expect(keys).toEqual([
      'PAYROLL_REGISTER',
      'EMPLOYER_COST',
      'STATUTORY_TOTALS',
      'VARIANCE',
      'CLAIMS',
      'PAYROLL_HISTORY',
      'PCB_SUMMARY',
      'YTD',
      'OVERTIME',
      'UNPAID_LEAVE',
      'INCENTIVES',
      'EXCEPTIONS',
      'PAYMENT_STATUS',
    ]);
    // The two the build still cannot serve, each carrying its reason — and
    // PAYROLL_HISTORY no longer among them, because it now exists.
    const missing = res.body.notAvailableYet.map((entry: { key: string }) => entry.key);
    expect(missing).toEqual(['STATUTORY_RECONCILIATION', 'PAYMENT_RECONCILIATION']);
  });

  it('the exceptions report is the record of what the run raised', async () => {
    const run = await request(server())
      .post('/workforce/payroll/runs')
      .set('Authorization', bearer)
      .send({ period: '2026-07', clinicId })
      .expect(201);
    runId = run.body.id;
    await request(server()).patch(`/workforce/payroll/runs/${runId}/calculate`).set('Authorization', bearer).expect(200);

    const report = await request(server())
      .get(`/workforce/payroll/runs/${runId}/reports/exceptions`)
      .set('Authorization', bearer)
      .expect(200);
    // Hana has no tax profile and no hand-entered figure yet: the one blocking
    // exception, open, named to her.
    const pcbMissing = report.body.rows.find((row: { code: string }) => row.code === 'PCB_MISSING');
    expect(pcbMissing).toBeTruthy();
    expect(pcbMissing.severity).toBe('BLOCKING');
    expect(pcbMissing.name).toBe('Hana Reports');
    expect(pcbMissing.overridden).toBe(false);
    expect(report.body.totals.blockingOpen).toBeGreaterThanOrEqual(1);
  });

  it('the PCB summary distinguishes calculated from entered, from the marker — not the prose', async () => {
    const before = await request(server())
      .get(`/workforce/payroll/runs/${runId}/reports/pcb`)
      .set('Authorization', bearer)
      .expect(200);
    const hanaBefore = before.body.rows.find((row: { staffId: string }) => row.staffId === hanaId);
    expect(hanaBefore.pcb).toBeNull();
    expect(hanaBefore.source).toBeNull();
    expect(before.body.totals.missing).toBe(1);
    // A column with an unknown in it has no honest total.
    expect(before.body.totals.pcb).toBeNull();

    // Enter Hana's PCB by hand and recalculate.
    await request(server())
      .post('/workforce/payroll/inputs')
      .set('Authorization', bearer)
      .send({ staffId: hanaId, period: '2026-07-01', componentCode: 'PCB', amount: '150.00', label: 'PCB per agent' })
      .expect(201);
    await request(server()).patch(`/workforce/payroll/runs/${runId}/calculate`).set('Authorization', bearer).expect(200);

    const after = await request(server())
      .get(`/workforce/payroll/runs/${runId}/reports/pcb`)
      .set('Authorization', bearer)
      .expect(200);
    const amira = after.body.rows.find((row: { staffId: string }) => row.staffId === amiraId);
    const hana = after.body.rows.find((row: { staffId: string }) => row.staffId === hanaId);
    expect(amira.source).toBe('CALCULATED');
    expect(hana.source).toBe('ENTERED');
    expect(hana.pcb).toBe('150.00');
    expect(hana.note).toMatch(/entered by hand/);
    expect(after.body.totals).toMatchObject({ calculated: 1, entered: 1, missing: 0 });
    expect(after.body.totals.pcb).not.toBeNull();

    // With the figure supplied, the run's exception record is clean.
    const exceptions = await request(server())
      .get(`/workforce/payroll/runs/${runId}/reports/exceptions`)
      .set('Authorization', bearer)
      .expect(200);
    expect(exceptions.body.totals.exceptions).toBe(0);
  });

  it('overtime is reported tier by tier, naming the provision that priced it', async () => {
    const report = await request(server())
      .get(`/workforce/payroll/runs/${runId}/reports/overtime`)
      .set('Authorization', bearer)
      .expect(200);
    expect(report.body.rows).toHaveLength(1);
    const row = report.body.rows[0];
    expect(row.staffId).toBe(amiraId);
    // Five hours of a Sunday: a rest day is paid in DAYS at the ordinary
    // rate, and the tier row says which section of the Act priced it.
    expect(row.tiers.length).toBeGreaterThanOrEqual(1);
    expect(row.tiers[0].provision).toMatch(/s\.60\(3\)/);
    expect(row.tiers[0].ordinaryRateDays).toBe(1);
    const line = await lineFor(amiraId);
    expect(report.body.totals.pay).toBe(Number(line.overtimePay).toFixed(2));
    expect(report.body.orp.meaning).toMatch(/÷ 26 days/);
  });

  it('unpaid leave is reported as a wage reduction, never a deduction', async () => {
    const report = await request(server())
      .get(`/workforce/payroll/runs/${runId}/reports/unpaid-leave`)
      .set('Authorization', bearer)
      .expect(200);
    expect(report.body.rows).toHaveLength(1);
    const row = report.body.rows[0];
    expect(row.staffId).toBe(amiraId);
    expect(row.days).toBe(1);
    const line = await lineFor(amiraId);
    expect(row.reduction).toBe(Number(line.unpaidLeaveDeduction).toFixed(2));
    // Gross in the report is the engine's gross — already after the reduction.
    expect(row.grossAfter).toBe(Number(line.grossPay).toFixed(2));
    expect(report.body.note).toMatch(/wage reduction, not a deduction/);
  });

  it('incentives and bonuses carry their provenance', async () => {
    const report = await request(server())
      .get(`/workforce/payroll/runs/${runId}/reports/incentives`)
      .set('Authorization', bearer)
      .expect(200);
    expect(report.body.rows).toHaveLength(2);
    expect(report.body.totals).toMatchObject({ incentives: '400.00', bonus: '1000.00', employees: 1 });
    for (const row of report.body.rows) {
      expect(row.name).toBe('Amira Reports');
      expect(row.source).toBe('MANUAL');
    }
    expect(report.body.note).toMatch(/additional remuneration/);
  });

  it('the register’s statutory column includes LINDUNG — everything withheld, not most of it', async () => {
    const line = await lineFor(amiraId);
    // July 2026 is after commencement and Amira opted in, so her LINDUNG
    // contribution is real money out of her pay.
    expect(Number(line.lindungEmployee)).toBeGreaterThan(0);
    const register = await request(server())
      .get(`/workforce/payroll/runs/${runId}/reports/register`)
      .set('Authorization', bearer)
      .expect(200);
    const row = register.body.rows.find((r: { staffId: string }) => r.staffId === amiraId);
    const expected =
      Math.round(
        (Number(line.epfEmployee) +
          Number(line.socsoEmployee) +
          Number(line.eisEmployee) +
          Number(line.lindungEmployee) +
          Number(line.pcb)) *
          100,
      ) / 100;
    expect(row.statutoryEmployee).toBe(expected.toFixed(2));
  });

  it('the year-to-date report shows approved months, says which were imported, and lists TP3 separately', async () => {
    await request(server())
      .patch(`/workforce/payroll/runs/${runId}/approve`)
      .set('Authorization', bearer)
      .send({ acknowledgeStatutoryGap: true })
      .expect(200);

    // Hana ran on another system for January and February.
    await request(server())
      .post('/workforce/payroll/ytd-opening')
      .set('Authorization', bearer)
      .send({
        legalEmployerId,
        source: 'Previous system payslips',
        months: [1, 2].map((month) => ({
          staffId: hanaId,
          taxYear: 2026,
          month,
          grossCents: 450000,
          pcbCents: 15000,
          epfEmployeeCents: 49500,
        })),
      })
      .expect(201);

    // A July joiner with previous employment declared on Form TP3 — parked in
    // a second branch so this describe's run keeps its two employees when the
    // correction test recalculates it.
    const otherClinic = await request(server())
      .post('/clinics')
      .set('Authorization', bearer)
      .send({ name: 'Second Branch' })
      .expect(201);
    const joinerId = await makeEmployee('July Joiner', '5000.00', {
      taxProfile: true,
      lindungParticipation: 'NOT_PARTICIPATING',
      startDate: '2026-06-15',
      clinicId: otherClinic.body.id,
    });
    await request(server())
      .post(`/workforce/employees/${joinerId}/tp3`)
      .set('Authorization', bearer)
      .send({
        taxYear: 2026,
        previousEmployerName: 'Old Firm Sdn Bhd',
        employmentFrom: '2026-01-05',
        employmentTo: '2026-06-10',
        grossCents: 3000000,
        epfCents: 330000,
        mtdPaidCents: 90000,
        source: 'Borang TP3 dated 12 June 2026',
      })
      .expect(201);

    const report = await request(server())
      .get('/workforce/payroll/reports/ytd?year=2026')
      .set('Authorization', bearer)
      .expect(200);

    const amira = report.body.rows.find((row: { staffId: string }) => row.staffId === amiraId);
    expect(amira.monthsRecorded).toBe(1);
    expect(amira.months).toEqual([{ month: 7, source: 'CALCULATED' }]);
    expect(amira.note).toBeNull();
    expect(Number(amira.lindungEmployee)).toBeGreaterThan(0);

    const hana = report.body.rows.find((row: { staffId: string }) => row.staffId === hanaId);
    expect(hana.monthsRecorded).toBe(3);
    expect(hana.note).toMatch(/2 of 3 months are imported/);

    // The TP3 is listed, named to the previous employer, and NOT a row above:
    // that money is in the tax calculation but it is not this employer's.
    const previous = report.body.previousEmployment.find((row: { staffId: string }) => row.staffId === joinerId);
    expect(previous).toMatchObject({ previousEmployerName: 'Old Firm Sdn Bhd', gross: '30000.00' });
    expect(report.body.rows.some((row: { staffId: string }) => row.staffId === joinerId)).toBe(false);
  });

  it('builds Borang EA from approved months, lists what is missing, and sums Borang E', async () => {
    const ea = await request(server()).get('/workforce/ea-forms?year=2026').set('Authorization', bearer).expect(200);
    type Form = { staffId: string; status: string; boxes: Record<string, number>; pcbCents: number; problems: { level: string; text: string }[] };
    const forms = ea.body.forms as Form[];
    const amira = forms.find((form) => form.staffId === amiraId)!;
    // July's item lines split into boxes that add up to the month's gross pay.
    expect(amira.boxes.B1a).toBeGreaterThan(0);
    expect(amira.problems.some((problem) => /differ/.test(problem.text))).toBe(false);
    // The employer has no LHDN number yet, so nothing is ready to file.
    expect(amira.status).toBe('INCOMPLETE');
    expect(amira.problems.map((problem) => problem.text)).toContain('Reports Employer Sdn Bhd has no LHDN employer number (E).');
    // Hana's imported January and February kept only totals: said, and put in B1(a).
    const hana = forms.find((form) => form.staffId === hanaId)!;
    expect(hana.problems.some((problem) => /^Jan, Feb: only the total was kept/.test(problem.text))).toBe(true);
    expect(hana.boxes.B1a).toBeGreaterThanOrEqual(900000);

    const pdf = await request(server()).get(`/workforce/ea-forms/${amiraId}/pdf?year=2026`).set('Authorization', bearer).buffer(true).expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');

    const borangE = await request(server()).get('/workforce/borang-e?year=2026').set('Authorization', bearer).expect(200);
    expect(borangE.body.dueDate).toBe('2027-03-31');
    expect(borangE.body.employers[0]).toMatchObject({ name: 'Reports Employer Sdn Bhd', employees: forms.length });
    // The revision printed on the form is the clinic's setting.
    expect((await request(server()).get('/workforce/ea-forms/version').set('Authorization', bearer).expect(200)).body.versionLabel).toBe('(C.P.8A - Pin. 2017)');
    await request(server()).put('/workforce/ea-forms/version').set('Authorization', bearer).send({ versionLabel: '(C.P.8A - Pin. 2024)' }).expect(200);
    const relabelled = await request(server()).get('/workforce/ea-forms?year=2026').set('Authorization', bearer).expect(200);
    expect(relabelled.body.forms[0].versionLabel).toBe('(C.P.8A - Pin. 2024)');
    const csv = await request(server()).get('/workforce/borang-e/cp8d.csv?year=2026').set('Authorization', bearer).expect(200);
    expect(csv.text).toContain('Income tax number');

    // The HR clerk without the reports permission cannot read anybody's EA form.
    await request(server()).get('/workforce/ea-forms?year=2026').set('Authorization', hrClerkBearer).expect(403);
  });

  it('history names a correction and keeps every version', async () => {
    const first = await request(server())
      .get(`/workforce/payroll/reports/history?staffId=${amiraId}`)
      .set('Authorization', bearer)
      .expect(200);
    expect(first.body.rows).toHaveLength(1);
    expect(first.body.rows[0]).toMatchObject({ status: 'APPROVED', approvedVersions: 1, note: null });

    await request(server())
      .patch(`/workforce/payroll/runs/${runId}/reopen`)
      .set('Authorization', bearer)
      .send({ reason: 'Correcting July' })
      .expect(200);
    const during = await request(server())
      .get(`/workforce/payroll/reports/history?staffId=${amiraId}`)
      .set('Authorization', bearer)
      .expect(200);
    // Mid-correction the line is a CANDIDATE and the report says so — and the
    // total refuses to count money nobody has approved.
    expect(during.body.rows[0].note).toMatch(/candidate figures.*version 1/);
    expect(during.body.totals.approvedRuns).toBe(0);

    await request(server()).patch(`/workforce/payroll/runs/${runId}/calculate`).set('Authorization', bearer).expect(200);
    await request(server())
      .patch(`/workforce/payroll/runs/${runId}/approve`)
      .set('Authorization', bearer)
      .send({ acknowledgeStatutoryGap: true })
      .expect(200);
    const after = await request(server())
      .get(`/workforce/payroll/reports/history?staffId=${amiraId}`)
      .set('Authorization', bearer)
      .expect(200);
    expect(after.body.rows[0].approvedVersions).toBe(2);
    expect(after.body.rows[0].note).toMatch(/2 approved versions/);
    expect(after.body.totals.approvedRuns).toBe(1);
  });

  it('payment status never says paid until a person records it', async () => {
    const before = await request(server())
      .get(`/workforce/payroll/runs/${runId}/reports/payment-status`)
      .set('Authorization', bearer)
      .expect(200);
    expect(before.body.current).toBeNull();
    expect(before.body.note).toMatch(/No payment listing/);

    await request(server()).post(`/workforce/payroll/runs/${runId}/payment/prepare`).set('Authorization', bearer).expect(201);
    await request(server()).get(`/workforce/payroll/runs/${runId}/payment/listing`).set('Authorization', bearer).expect(200);
    const generated = await request(server())
      .get(`/workforce/payroll/runs/${runId}/reports/payment-status`)
      .set('Authorization', bearer)
      .expect(200);
    expect(generated.body.current.status).toBe('DOWNLOADED');
    expect(generated.body.current.statusMeans).toMatch(/not evidence any money moved/);
    expect(generated.body.runPaidAt).toBeNull();

    await request(server())
      .post(`/workforce/payroll/runs/${runId}/payment/record-paid`)
      .set('Authorization', bearer)
      .send({ paymentDate: '2026-07-28', reference: 'IBG-20260728-777001' })
      .expect(201);
    const paid = await request(server())
      .get(`/workforce/payroll/runs/${runId}/reports/payment-status`)
      .set('Authorization', bearer)
      .expect(200);
    expect(paid.body.current.status).toBe('RECORDED_PAID');
    expect(paid.body.current.paymentReference).toBe('IBG-20260728-777001');
    expect(paid.body.current.statusMeans).toMatch(/A person recorded/);
    expect(paid.body.runPaidAt).not.toBeNull();
    // Every employee is on the listing with the account's last four only.
    const amiraLine = paid.body.current.lines.find((line: { staffId: string }) => line.staffId === amiraId);
    expect(amiraLine).toMatchObject({ included: true, accountEnding: '7766' });
  });

  it('the finance contract serves canonical liabilities to finance.view — and nothing per-employee', async () => {
    await request(server())
      .post(`/workforce/payroll/runs/${runId}/statutory-outputs/epf/record-submission`)
      .set('Authorization', bearer)
      .send({ submittedDate: '2026-08-10', reference: 'KWSP-ACK-42' })
      .expect(201);

    const res = await request(server())
      .get('/workforce/payroll/finance/liabilities?year=2026')
      .set('Authorization', financeBearer)
      .expect(200);
    expect(res.body.runs).toHaveLength(1);
    const run = res.body.runs[0];
    expect(run).toMatchObject({ runId, period: '2026-07', status: 'PAID' });
    expect(run.snapshot).toMatchObject({ version: 2, verdict: 'VERIFIED' });

    // The liability figures are the approved snapshot's, to the sen.
    const detail = await request(server())
      .get(`/workforce/payroll/runs/${runId}`)
      .set('Authorization', bearer)
      .expect(200);
    expect(run.liabilities.netPayCents).toBe(Math.round(Number(detail.body.netTotal) * 100));
    expect(run.liabilities.employeeCount).toBe(2);

    const scheme = (name: string) => run.liabilities.statutory.find((row: { scheme: string }) => row.scheme === name);
    expect(scheme('LINDUNG').employeeCents).toBeGreaterThan(0);
    expect(scheme('LINDUNG').employerCents).toBeNull();
    // NOT_REGISTERED with HRD: a levy of zero is a computed fact, not a gap.
    expect(scheme('HRD')).toMatchObject({ employerCents: 0, notComputed: 0 });
    expect(scheme('PCB').employeeCents).toBeGreaterThan(0);

    expect(run.payment.state).toBe('RECORDED_PAID');
    expect(run.payment.paymentReference).toBe('IBG-20260728-777001');
    expect(run.submissions).toEqual([
      { scheme: 'EPF', submittedDate: '2026-08-10', reference: 'KWSP-ACK-42' },
    ]);

    // AGGREGATES ONLY. No employee's name or pay crosses this boundary.
    expect(JSON.stringify(res.body)).not.toContain('Amira');
    expect(run.liabilities.employees).toBeUndefined();
  });

  it('the boundary holds both ways: finance cannot read HR reports, HR cannot read the contract', async () => {
    await request(server())
      .get(`/workforce/payroll/runs/${runId}/reports/register`)
      .set('Authorization', financeBearer)
      .expect(403);
    await request(server())
      .get(`/workforce/payroll/reports/history?staffId=${amiraId}`)
      .set('Authorization', hrClerkBearer)
      .expect(403);
    await request(server())
      .get('/workforce/payroll/finance/liabilities?year=2026')
      .set('Authorization', hrClerkBearer)
      .expect(403);
  });

  it('a run that was never approved does not appear in the contract at all', async () => {
    const august = await request(server())
      .post('/workforce/payroll/runs')
      .set('Authorization', bearer)
      .send({ period: '2026-08', clinicId })
      .expect(201);
    await request(server())
      .patch(`/workforce/payroll/runs/${august.body.id}/calculate`)
      .set('Authorization', bearer)
      .expect(200);

    const res = await request(server())
      .get('/workforce/payroll/finance/liabilities?year=2026')
      .set('Authorization', financeBearer)
      .expect(200);
    // Finance accrues what was APPROVED. A calculated run is a proposal.
    expect(res.body.runs.map((row: { period: string }) => row.period)).toEqual(['2026-07']);
  });
});
