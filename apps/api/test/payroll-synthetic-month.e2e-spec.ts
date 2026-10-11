import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();

/**
 * ONE SYNTHETIC MONTH, RECONCILED END TO END.
 *
 * July 2026 for one clinic, built to contain every case the programme claims
 * to handle at once: rest-day and public-holiday work priced in days, unpaid
 * leave as a wage reduction, an incentive, a bonus, a claim paid with salary
 * beside one reimbursed by Finance, a TP1 month with self-paid zakat and
 * zakat through payroll, a hand-entered PCB, a non-citizen with mandatory
 * LINDUNG and non-resident tax, a mid-month joiner carrying a TP3, a
 * mid-month leaver with no bank account, and a section-14 HRD employer so
 * the levy is real money.
 *
 * The point is not any single figure. It is the CHAIN: earnings less wage
 * reductions make gross; gross less employee deductions makes net; gross plus
 * employer contributions makes employer cost; the run's totals are the sum of
 * its lines; the approved snapshot reproduces them; the payment listing's
 * included and excluded rows re-add to net; the statutory outputs re-add to
 * the same lines; the year-to-date ledger holds the same cents; and the
 * Finance contract hands over the same liabilities — one calculation, read
 * from nine surfaces, agreeing to the sen on every one.
 */
describe('Synthetic payroll month (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;
  let legalEmployerId: string;
  let runId: string;

  let aina: string; // RM3,900 · rest-day + public-holiday work · LINDUNG opted in
  let farid: string; // RM3,000 · 2 days unpaid leave · incentive · claim via payroll
  let mei: string; // RM8,000 · bonus · TP1 (LP + self-paid zakat) · zakat via payroll
  let ravi: string; // RM2,600 · non-citizen · non-resident 30% · LINDUNG mandatory · no EIS
  let siti: string; // RM5,000 · joins 15 July · TP3 from previous employer
  let hana: string; // RM3,400 · no tax profile · PCB entered by hand
  let zul: string; // RM3,100 · leaves 20 July · no bank account

  const server = () => app.getHttpServer();
  const PERIOD = '2026-07';

  const cents = (value: unknown) => Math.round(Number(value) * 100);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, name: 'Synthetic Month Tenant' } }),
    );
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    // The claims this world posts carry no receipt; the policy insists on one by default.
    await request(server()).put('/workforce/claim-policy').set('Authorization', bearer).send({ receiptRequired: false, reason: 'Test world: paper receipts' }).expect(200);

    const clinic = await request(server())
      .post('/clinics')
      .set('Authorization', bearer)
      .send({ name: 'Synthetic Clinic' })
      .expect(201);
    clinicId = clinic.body.id;

    const employer = await request(server())
      .post('/workforce/legal-employers')
      .set('Authorization', bearer)
      // Zakat through payroll on: the cast includes somebody whose zakat is taken from pay.
      .send({ name: 'Synthetic Sdn Bhd', zakatThroughPayroll: true })
      .expect(201);
    legalEmployerId = employer.body.id;
    // Section 14: the mandatory 1% class, so the levy is a real employer cost.
    await request(server())
      .post(`/workforce/legal-employers/${legalEmployerId}/statutory-profile`)
      .set('Authorization', bearer)
      .send({ effectiveFrom: '2024-01-01', hrdRegistration: 'MANDATORY_SECTION_14', reason: 'Registered employer' })
      .expect(201);

    await request(server()).post('/workforce/pay-components/seed').set('Authorization', bearer).expect(201);
    // This month is one pay date: the claim paid with salary on the 30th, not
    // the standard items' 15th, so the payment listing is the whole run.
    await request(server()).patch('/workforce/pay-components/CLAIM_REIMBURSEMENT/pay-date').set('Authorization', bearer).send({ payDay: 30 }).expect(200);

    aina = await makeEmployee('Aina Rahim', '3900.00', {});
    farid = await makeEmployee('Farid Musa', '3000.00', {});
    mei = await makeEmployee('Mei Ling', '8000.00', {});
    ravi = await makeEmployee('Ravi Kumar', '2600.00', {
      epfMembership: 'NON_CITIZEN',
      taxResidence: 'NON_RESIDENT',
      lindungParticipation: 'MANDATORY_FOREIGN_WORKER',
      eisApplicable: false,
    });
    siti = await makeEmployee('Siti Aminah', '5000.00', { startDate: '2026-07-15' });
    hana = await makeEmployee('Hana Yusof', '3400.00', { taxProfile: false });
    zul = await makeEmployee('Zul Ikmal', '3100.00', { endDate: '2026-07-20', bank: false });

    await withTenantContext(prisma, tenantId, async (tx) => {
      // Aina opts into LINDUNG — recorded on her standing.
      // (Her classification is re-recorded below via the API instead.)
      // Public holiday on Tuesday 7 July; Aina works two hours of it, and five
      // hours of her Sunday rest day on the 5th.
      await tx.publicHoliday.create({
        data: { tenantId, date: new Date('2026-07-07T00:00:00.000Z'), name: 'Synthetic Holiday' },
      });
      await tx.attendanceRecord.create({
        data: {
          tenantId,
          staffId: aina,
          clinicId,
          workDate: new Date('2026-07-05T00:00:00.000Z'),
          status: 'PRESENT',
          workedMinutes: 300,
        },
      });
      await tx.attendanceRecord.create({
        data: {
          tenantId,
          staffId: aina,
          clinicId,
          workDate: new Date('2026-07-07T00:00:00.000Z'),
          status: 'PRESENT',
          workedMinutes: 120,
        },
      });
      // Farid: two days without pay.
      await tx.leaveRequest.create({
        data: {
          tenantId,
          staffId: farid,
          leaveType: 'UNPAID',
          startDate: new Date('2026-07-08T00:00:00.000Z'),
          endDate: new Date('2026-07-09T00:00:00.000Z'),
          status: 'APPROVED',
          reason: 'Family matter',
        },
      });
    });
    // Aina's LINDUNG participation, recorded properly as a dated standing.
    await request(server())
      .post(`/workforce/employees/${aina}/statutory-classification`)
      .set('Authorization', bearer)
      .send({ effectiveFrom: '2026-07-01', lindungParticipation: 'ENROLLED', reason: 'Opted in from July' })
      .expect(201);

    // Manual inputs: Farid's incentive, Mei's bonus and payroll-deducted zakat,
    // Hana's hand-entered PCB.
    for (const [staffId, componentCode, amount, label] of [
      [farid, 'INCENTIVE', '250.00', 'July target incentive'],
      [mei, 'BONUS', '2000.00', 'Mid-year bonus'],
      [mei, 'ZAKAT', '50.00', 'Zakat via payroll'],
      [hana, 'PCB', '95.00', 'PCB per LHDN agent'],
    ] as const) {
      await request(server())
        .post('/workforce/payroll/inputs')
        .set('Authorization', bearer)
        .send({ staffId, period: `${PERIOD}-01`, componentCode, amount, label })
        .expect(201);
    }

    // Mei's TP1 for July: RM300 of approved deductions, RM100 zakat she paid
    // herself.
    await request(server())
      .post(`/workforce/employees/${mei}/tp1`)
      .set('Authorization', bearer)
      .send({
        period: PERIOD,
        deductionsCents: 30000,
        zakatSelfPaidCents: 10000,
        items: [{ label: 'Lifestyle — books and sports equipment', amountCents: 30000 }],
        receivedDate: '2026-07-03',
      })
      .expect(201);

    // Siti's previous employment, declared on TP3.
    await request(server())
      .post(`/workforce/employees/${siti}/tp3`)
      .set('Authorization', bearer)
      .send({
        taxYear: 2026,
        previousEmployerName: 'Former Employer Sdn Bhd',
        employmentFrom: '2026-01-02',
        employmentTo: '2026-06-30',
        grossCents: 2700000,
        epfCents: 297000,
        mtdPaidCents: 120000,
        source: 'Borang TP3 dated 10 July 2026',
      })
      .expect(201);

    // Farid's two claims: one paid with salary, one reimbursed by Finance.
    const claimVia = async (route: 'PAYROLL' | 'FINANCE', amount: string, description: string) => {
      const claim = await request(server())
        .post('/workforce/claims')
        .set('Authorization', bearer)
        .send({ staffId: farid, category: 'TRAVEL', description, amountClaimed: amount, claimDate: '2026-07-06' })
        .expect(201);
      await request(server())
        .post(`/workforce/claims/${claim.body.id}/decide`)
        .set('Authorization', bearer)
        .send({ decision: 'APPROVED', amountApproved: amount, paymentRoute: route, reason: 'Receipts attached' })
        .expect(201);
      return claim.body.id as string;
    };
    await claimVia('PAYROLL', '85.00', 'Taxi between branches');
    await claimVia('FINANCE', '40.00', 'Parking at the summit');

    // Pull the claim into the period's inputs the same way the screen does.
    await request(server())
      .post('/workforce/payroll/inputs/materialise')
      .set('Authorization', bearer)
      .send({ period: `${PERIOD}-01`, clinicId })
      .expect(201);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  /**
   * One sequence per run. The tenant is new each run, so a counter cannot
   * collide inside it; a random draw from a million once did, and took the
   * whole suite down in beforeAll.
   */
  let employeeSeq = 0;

  async function makeEmployee(
    name: string,
    salary: string,
    opts: {
      startDate?: string;
      endDate?: string;
      bank?: boolean;
      taxProfile?: boolean;
      epfMembership?: string;
      taxResidence?: string;
      lindungParticipation?: string;
      eisApplicable?: boolean;
    },
  ): Promise<string> {
    const startDate = opts.startDate ?? '2024-01-01';
    const staff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: name, clinicId } }),
    );
    await request(server())
      .post(`/workforce/employees/${staff.id}`)
      .set('Authorization', bearer)
      .send({
        employeeNo: `S-${String((employeeSeq += 1)).padStart(3, '0')}`,
        position: 'Clinic Assistant',
        employmentType: 'PERMANENT',
        employmentStatus: 'ACTIVE',
        startDate,
        ...(opts.endDate ? { endDate: opts.endDate } : {}),
        dateOfBirth: '1992-05-05',
        ...(opts.bank === false ? {} : { bankName: 'Maybank', bankAccountNo: `51244${Math.floor(Math.random() * 10000000)}` }),
      })
      .expect(201);
    await request(server())
      .post(`/workforce/employees/${staff.id}/statutory-classification`)
      .set('Authorization', bearer)
      .send({
        effectiveFrom: startDate,
        epfMembership: opts.epfMembership ?? 'MALAYSIAN_CITIZEN',
        ...(opts.taxProfile === false
          ? {}
          : { taxResidence: opts.taxResidence ?? 'RESIDENT', pcbCategory: 'CATEGORY_1', qualifyingChildren: 0 }),
        ...(opts.eisApplicable === false ? { eisApplicable: false } : {}),
        restDayOfWeek: 0,
        lindungParticipation: opts.lindungParticipation ?? 'NOT_PARTICIPATING',
        ...(cents(salary) > 400000 ? { overtimeContractPolicy: 'PAY_AT_STATUTORY_RATES' } : {}),
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

  async function detail() {
    const res = await request(server()).get(`/workforce/payroll/runs/${runId}`).set('Authorization', bearer).expect(200);
    return res.body as {
      grossTotal: number;
      deductionTotal: number;
      netTotal: number;
      employerCostTotal: number;
      employeeCount: number;
      lines: Record<string, never>[];
    };
  }

  const lineOf = (body: Awaited<ReturnType<typeof detail>>, staffId: string) =>
    body.lines.find((line) => (line as { staffId?: string }).staffId === staffId) as Record<string, unknown>;

  it('calculates the month with every case on one run, and no exceptions left standing', async () => {
    const run = await request(server())
      .post('/workforce/payroll/runs')
      .set('Authorization', bearer)
      .send({ period: PERIOD, clinicId })
      .expect(201);
    runId = run.body.id;
    await request(server()).patch(`/workforce/payroll/runs/${runId}/calculate`).set('Authorization', bearer).expect(200);

    const body = await detail();
    expect(body.employeeCount).toBe(7);

    const exceptions = await request(server())
      .get(`/workforce/payroll/runs/${runId}/reports/exceptions`)
      .set('Authorization', bearer)
      .expect(200);
    // INFO rows (part-month joiners and leavers) are explanations, not
    // blockers. Nothing blocking and nothing warned.
    expect(exceptions.body.totals.blockingOpen).toBe(0);
    expect(exceptions.body.totals.warnings).toBe(0);
  });

  it('prices the Employment Act cases exactly: days for the holiday and rest day, s.18A for absence and part months', async () => {
    const body = await detail();

    // Aina, RM3,900: ORP = 3900/26 = RM150.00 a day exactly. Two hours of a
    // public holiday are two DAYS (s.60D) = RM300; five hours of her Sunday
    // (more than half a 7.5h day) is one day (s.60(3)) = RM150.
    const ainaLine = lineOf(body, aina);
    expect(Number(ainaLine.overtimePay)).toBe(450);

    // Farid, RM3,000: two days of July at 3000/31 each, taken OFF the wages —
    // his gross is already after it.
    const faridLine = lineOf(body, farid);
    const dailyCents = Math.round(300000 / 31);
    expect(cents(faridLine.unpaidLeaveDeduction)).toBe(dailyCents * 2);
    // Earnings: basic + incentive + the claim paid with salary, less the
    // absence. The FINANCE-routed claim is nowhere in it.
    expect(cents(faridLine.grossPay)).toBe(300000 - dailyCents * 2 + 25000 + 8500);

    // Siti joins on the 15th: 17 of 31 days under s.18A.
    const sitiLine = lineOf(body, siti);
    expect(cents(sitiLine.basicSalary)).toBe(Math.round((500000 / 31) * 17));

    // Zul leaves on the 20th: 20 of 31 days.
    const zulLine = lineOf(body, zul);
    expect(cents(zulLine.basicSalary)).toBe(Math.round((310000 / 31) * 20));
  });

  it('every line adds up in both directions, and the run totals are the sum of the lines', async () => {
    const body = await detail();
    let gross = 0;
    let net = 0;
    let employerCost = 0;

    for (const line of body.lines) {
      const l = line as Record<string, unknown>;
      const statutoryEmployee =
        cents(l.epfEmployee ?? 0) +
        cents(l.socsoEmployee ?? 0) +
        cents(l.eisEmployee ?? 0) +
        cents(l.lindungEmployee ?? 0) +
        cents(l.pcb ?? 0);
      // Gross − everything withheld = take-home.
      expect(cents(l.grossPay) - statutoryEmployee - cents(l.otherDeductions)).toBe(cents(l.netPay));
      // Gross + everything the employer pays on top = the cost of employing them.
      const employerContribution =
        cents(l.epfEmployer ?? 0) + cents(l.socsoEmployer ?? 0) + cents(l.eisEmployer ?? 0) + cents(l.hrdLevy ?? 0);
      expect(cents(l.grossPay) + employerContribution).toBe(cents(l.employerCost));
      gross += cents(l.grossPay);
      net += cents(l.netPay);
      employerCost += cents(l.employerCost);
    }
    expect(cents(body.grossTotal)).toBe(gross);
    expect(cents(body.netTotal)).toBe(net);
    expect(cents(body.employerCostTotal)).toBe(employerCost);

    // The register report re-serves the same totals — one source, two surfaces.
    const register = await request(server())
      .get(`/workforce/payroll/runs/${runId}/reports/register`)
      .set('Authorization', bearer)
      .expect(200);
    expect(cents(register.body.totals.grossPay)).toBe(gross);
    expect(cents(register.body.totals.netPay)).toBe(net);
    expect(cents(register.body.totals.employerCost)).toBe(employerCost);
  });

  it('the statutory engines hit every branch the cast was built for', async () => {
    const body = await detail();

    // LINDUNG comes out of the pay of exactly the two participants.
    expect(cents(lineOf(body, aina).lindungEmployee)).toBeGreaterThan(0);
    expect(cents(lineOf(body, ravi).lindungEmployee)).toBeGreaterThan(0);
    expect(cents(lineOf(body, farid).lindungEmployee)).toBe(0);

    // The section-14 levy is 1% of leviable wages for citizens in full-time
    // employment: exactly RM39.00 on Aina's RM3,900 basic (overtime is not in
    // the base), zero for the non-citizen — never null on this run.
    expect(Number(lineOf(body, aina).hrdLevy)).toBe(39);
    expect(Number(lineOf(body, ravi).hrdLevy)).toBe(0);

    // The non-citizen has no EIS (recorded as outside the scheme) and a
    // non-resident's tax, which the note names.
    const raviLine = lineOf(body, ravi);
    expect(cents(raviLine.eisEmployee ?? 0)).toBe(0);
    expect(Number(raviLine.pcb)).toBeGreaterThan(0);
    const raviBreakdown = raviLine.breakdown as { statutoryNotes: { pcb: string | null } };
    expect(raviBreakdown.statutoryNotes.pcb).toMatch(/non-resident/i);

    // Mei's TP1 was applied and the payslip says so; her zakat through payroll
    // reduces the tax as well.
    const meiBreakdown = (lineOf(body, mei).breakdown ?? {}) as {
      statutoryNotes?: { pcb?: string | null };
      pcbSource?: string;
    };
    expect(meiBreakdown.statutoryNotes?.pcb).toMatch(/TP1 deductions/);
    expect(meiBreakdown.pcbSource).toBe('CALCULATED');

    // Hana's figure is the one a person typed, and it is marked as such.
    const hanaLine = lineOf(body, hana);
    expect(Number(hanaLine.pcb)).toBe(95);
    expect((hanaLine.breakdown as { pcbSource?: string }).pcbSource).toBe('ENTERED');
  });

  it('approval freezes a VERIFIED snapshot and writes the year-to-date ledger in the same cents', async () => {
    await request(server())
      .patch(`/workforce/payroll/runs/${runId}/approve`)
      .set('Authorization', bearer)
      .send({ acknowledgeStatutoryGap: true })
      .expect(200);

    const snapshot = await request(server())
      .get(`/workforce/payroll/runs/${runId}/snapshots/1`)
      .set('Authorization', bearer)
      .expect(200);
    expect(snapshot.body.verification.verdict).toBe('VERIFIED');

    const body = await detail();
    const ytdRows = await withTenantContext(prisma, tenantId, (tx) =>
      tx.employeeYtd.findMany({ where: { taxYear: 2026, month: 7 } }),
    );
    expect(ytdRows).toHaveLength(7);
    for (const row of ytdRows) {
      const line = lineOf(body, row.staffId);
      expect(row.grossCents).toBe(cents(line.grossPay));
      expect(row.pcbCents).toBe(cents(line.pcb ?? 0));
      expect(row.epfEmployeeCents).toBe(cents(line.epfEmployee ?? 0));
      expect(row.lindungEmployeeCents).toBe(cents(line.lindungEmployee ?? 0));
    }
    // Mei's ledger holds the TP1: the LP feeding next month's cumulative
    // deduction, and her zakat as RM50 through payroll + RM100 self-paid.
    const meiYtd = ytdRows.find((row) => row.staffId === mei);
    expect(meiYtd?.deductionsCents).toBe(30000);
    expect(meiYtd?.zakatCents).toBe(15000);
  });

  it('the payment listing re-adds to net pay: included plus excluded, nobody dropped', async () => {
    await request(server()).post(`/workforce/payroll/runs/${runId}/payment/prepare`).set('Authorization', bearer).expect(201);
    const status = await request(server())
      .get(`/workforce/payroll/runs/${runId}/payment`)
      .set('Authorization', bearer)
      .expect(200);
    const batch = status.body.batch;
    expect(batch.includedCount).toBe(6);
    // Zul has no bank account: named and excluded, never silently dropped.
    expect(batch.excludedCount).toBe(1);
    const excluded = batch.lines.filter((line: { included: boolean }) => !line.included);
    expect(excluded).toHaveLength(1);
    expect(excluded[0].staffId).toBe(zul);

    const body = await detail();
    const excludedCents = excluded.reduce((sum: number, line: { amountCents: number }) => sum + line.amountCents, 0);
    expect(batch.totalCents + excludedCents).toBe(cents(body.netTotal));

    // Download, then record that it was actually paid — the only step that may
    // use the word.
    await request(server()).get(`/workforce/payroll/runs/${runId}/payment/listing`).set('Authorization', bearer).expect(200);
    await request(server())
      .post(`/workforce/payroll/runs/${runId}/payment/record-paid`)
      .set('Authorization', bearer)
      .send({ paymentDate: '2026-07-28', reference: 'IBG-SYN-20260728' })
      .expect(201);
  });

  it('the statutory outputs re-add to the same lines, scheme by scheme', async () => {
    const body = await detail();
    const outputs = await request(server())
      .get(`/workforce/payroll/runs/${runId}/statutory-outputs`)
      .set('Authorization', bearer)
      .expect(200);

    const sum = (pick: (line: Record<string, unknown>) => unknown) =>
      body.lines.reduce((total, line) => total + cents(pick(line as Record<string, unknown>) ?? 0), 0);
    const scheme = (name: string) => outputs.body.schemes.find((row: { scheme: string }) => row.scheme === name);

    expect(scheme('EPF').employeeTotalCents).toBe(sum((l) => l.epfEmployee));
    expect(scheme('EPF').employerTotalCents).toBe(sum((l) => l.epfEmployer));
    expect(scheme('SOCSO').employeeTotalCents).toBe(sum((l) => l.socsoEmployee));
    expect(scheme('EIS').employeeTotalCents).toBe(sum((l) => l.eisEmployee));
    expect(scheme('LINDUNG').employeeTotalCents).toBe(sum((l) => l.lindungEmployee));
    expect(scheme('PCB').employeeTotalCents).toBe(sum((l) => l.pcb));
    expect(scheme('HRD').employerTotalCents).toBe(sum((l) => l.hrdLevy));
    expect(scheme('HRD').employerTotalCents).toBeGreaterThan(0);

    // Record the EPF filing, once.
    await request(server())
      .post(`/workforce/payroll/runs/${runId}/statutory-outputs/epf/record-submission`)
      .set('Authorization', bearer)
      .send({ submittedDate: '2026-08-10', reference: 'KWSP-SYN-1' })
      .expect(201);
  });

  it('the Finance contract hands over the same liabilities, payment state and filing record', async () => {
    const body = await detail();
    const res = await request(server())
      .get('/workforce/payroll/finance/liabilities?year=2026')
      .set('Authorization', bearer)
      .expect(200);
    const run = res.body.runs.find((row: { runId: string }) => row.runId === runId);
    expect(run.snapshot.verdict).toBe('VERIFIED');
    expect(run.liabilities.netPayCents).toBe(cents(body.netTotal));
    expect(run.liabilities.employerCostCents).toBe(cents(body.employerCostTotal));

    const scheme = (name: string) => run.liabilities.statutory.find((row: { scheme: string }) => row.scheme === name);
    const sum = (pick: (line: Record<string, unknown>) => unknown) =>
      body.lines.reduce((total, line) => total + cents(pick(line as Record<string, unknown>) ?? 0), 0);
    expect(scheme('HRD').employerCents).toBe(sum((l) => l.hrdLevy));
    expect(scheme('LINDUNG').employeeCents).toBe(sum((l) => l.lindungEmployee));
    expect(scheme('PCB').employeeCents).toBe(sum((l) => l.pcb));

    expect(run.payment.state).toBe('RECORDED_PAID');
    expect(run.payment.paymentReference).toBe('IBG-SYN-20260728');
    expect(run.submissions).toEqual([{ scheme: 'EPF', submittedDate: '2026-08-10', reference: 'KWSP-SYN-1' }]);
  });

  it('the month reads correctly from the reports: claims routes, overtime tiers, absence, extras and the tax summary', async () => {
    const claims = await request(server())
      .get('/workforce/payroll/reports/claims?from=2026-07-01&to=2026-07-31')
      .set('Authorization', bearer)
      .expect(200);
    expect(claims.body.totals.throughPayroll).toBe('85.00');
    expect(claims.body.totals.throughFinance).toBe('40.00');
    const payrollClaim = claims.body.rows.find((row: { route: string }) => row.route === 'PAYROLL');
    // Settled means LINKED to the payroll input that paid it, not merely intended.
    expect(payrollClaim.settled).toBe(true);

    const overtime = await request(server())
      .get(`/workforce/payroll/runs/${runId}/reports/overtime`)
      .set('Authorization', bearer)
      .expect(200);
    expect(overtime.body.rows).toHaveLength(1);
    const provisions = overtime.body.rows[0].tiers.map((tier: { provision: string }) => tier.provision).join(' ');
    expect(provisions).toMatch(/60D/);
    expect(provisions).toMatch(/60\(3\)/);

    const unpaidLeave = await request(server())
      .get(`/workforce/payroll/runs/${runId}/reports/unpaid-leave`)
      .set('Authorization', bearer)
      .expect(200);
    expect(unpaidLeave.body.rows).toHaveLength(1);
    expect(unpaidLeave.body.rows[0]).toMatchObject({ staffId: farid, days: 2 });

    const incentives = await request(server())
      .get(`/workforce/payroll/runs/${runId}/reports/incentives`)
      .set('Authorization', bearer)
      .expect(200);
    expect(incentives.body.totals).toMatchObject({ incentives: '250.00', bonus: '2000.00' });

    const pcb = await request(server())
      .get(`/workforce/payroll/runs/${runId}/reports/pcb`)
      .set('Authorization', bearer)
      .expect(200);
    expect(pcb.body.totals).toMatchObject({ employees: 7, calculated: 6, entered: 1, missing: 0, tp1Applied: 1 });
  });

  /*
   * A CLAIM IS PAID ONCE, BY ONE ROUTE.
   *
   * Everything above proves the month adds up. This proves the thing that
   * would not show up in any total: a claim reaching a payslip twice, or
   * reaching one at all after Finance was told to reimburse it. Both are
   * silent — the run still balances, the reports still agree — and both cost a
   * clinic real money.
   */
  describe('paid exactly once', () => {
    const claimsOf = (route: 'PAYROLL' | 'FINANCE') =>
      withTenantContext(prisma, tenantId, (tx) =>
        tx.staffClaim.findMany({ where: { tenantId, staffId: farid, paymentRoute: route } }),
      );

    it('the payroll-routed claim is bound to exactly one payroll input, and reads PAID once the run is', async () => {
      const [claim] = await claimsOf('PAYROLL');
      expect(claim.payrollInputEntryId).toBeTruthy();
      // The run was recorded paid above (Piece 3g): a claim that rode on its
      // lines has been paid with the salary, and says so.
      expect(claim.payoutStatus).toBe('PAID');
      expect(claim.paidAt).not.toBeNull();

      const inputs = await withTenantContext(prisma, tenantId, (tx) =>
        tx.payrollInputEntry.findMany({ where: { tenantId, staffId: farid, source: 'CLAIM' } }),
      );
      expect(inputs).toHaveLength(1);
      expect(inputs[0].id).toBe(claim.payrollInputEntryId);
      expect(inputs[0].amount.toString()).toBe('85');
    });

    it('PULLING UPSTREAM FIGURES IN AGAIN, on a paid month, is refused outright', async () => {
      // The realistic way this goes wrong: somebody presses the button again
      // on a month that is already approved and paid. The answer is not a
      // silent no-op — that leaves a person believing something happened — and
      // it is certainly not a second input row. It is a refusal that names the
      // month and says why.
      const [before] = await claimsOf('PAYROLL');
      const again = await request(server())
        .post('/workforce/payroll/inputs/materialise')
        .set('Authorization', bearer)
        .send({ period: PERIOD, clinicId });
      expect(again.status).toBe(409);
      expect(String(again.body.message)).toMatch(/already paid/i);

      // And nothing moved: still one input, still the same binding.
      const inputs = await withTenantContext(prisma, tenantId, (tx) =>
        tx.payrollInputEntry.findMany({ where: { tenantId, staffId: farid, source: 'CLAIM' } }),
      );
      expect(inputs).toHaveLength(1);
      const [after] = await claimsOf('PAYROLL');
      expect(after.payrollInputEntryId).toBe(before.payrollInputEntryId);
    });

    it('the Finance-routed claim NEVER reaches a payslip', async () => {
      const [claim] = await claimsOf('FINANCE');
      // No link, and nothing in the period's inputs carrying its id.
      expect(claim.payrollInputEntryId).toBeNull();
      const linked = await withTenantContext(prisma, tenantId, (tx) =>
        tx.payrollInputEntry.findMany({ where: { tenantId, sourceRecordId: claim.id } }),
      );
      expect(linked).toEqual([]);
    });

    it('the database itself refuses TWO claims against one payroll input', async () => {
      // What `StaffClaim.payrollInputEntryId @unique` actually guarantees, said
      // precisely: an input row pays at most one claim. It is the half of the
      // guard that survives somebody writing a new code path which forgets the
      // service-level check — and it is NOT the same as "a claim has one
      // link", which is true simply because the column holds one value.
      const [paid] = await claimsOf('PAYROLL');
      const [finance] = await claimsOf('FINANCE');
      expect(paid.payrollInputEntryId).toBeTruthy();

      await expect(
        withTenantContext(prisma, tenantId, (tx) =>
          tx.staffClaim.update({
            where: { id: finance.id },
            data: { payrollInputEntryId: paid.payrollInputEntryId },
          }),
        ),
      ).rejects.toThrow();

      // Neither claim moved.
      expect((await claimsOf('PAYROLL'))[0].payrollInputEntryId).toBe(paid.payrollInputEntryId);
      expect((await claimsOf('FINANCE'))[0].payrollInputEntryId).toBeNull();
    });

    it('a SECOND MONTH cannot pick up a claim July already paid', async () => {
      /*
       * The double payment this guard exists to stop, reproduced.
       *
       * July paid the taxi fare and holds the link. Something then moves the
       * claim into August — a stale plan, a corrected date, two runs whose
       * periods overlap — and August's CALCULATION wants an input for a claim
       * that has already been paid once. (Claims are bound during calculate,
       * not by the materialise endpoint, which carries incentives.) The
       * service must refuse, and say so in words a clinic manager can act on.
       */
      const [claim] = await claimsOf('PAYROLL');
      const julyInput = claim.payrollInputEntryId;
      expect(julyInput).toBeTruthy();

      await withTenantContext(prisma, tenantId, (tx) =>
        tx.staffClaim.update({ where: { id: claim.id }, data: { payrollPeriod: new Date('2026-08-01') } }),
      );

      const august = await request(server())
        .post('/workforce/payroll/runs')
        .set('Authorization', bearer)
        .send({ period: '2026-08', clinicId })
        .expect(201);
      const calculated = await request(server())
        .patch(`/workforce/payroll/runs/${august.body.id}/calculate`)
        .set('Authorization', bearer);

      expect(calculated.status).toBe(409);
      expect(String(calculated.body.message)).toMatch(/paid once, by one route/i);

      // August created nothing for it, and July's payment is untouched.
      const inputs = await withTenantContext(prisma, tenantId, (tx) =>
        tx.payrollInputEntry.findMany({ where: { tenantId, sourceRecordId: claim.id } }),
      );
      expect(inputs).toHaveLength(1);
      expect(inputs[0].id).toBe(julyInput);
    });
  });
});
