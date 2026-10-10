import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { bearerFor, createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();

/**
 * ONE PAYROLL MONTH, PAID ON THREE DATES (UAT, 10 October 2026).
 *
 * Salary on the 30th, a director's fee on the 1st of the next month, locum
 * and claims on the 15th. The statutory figures and the payslip stay on the
 * whole month; only the money is split: the approved record says what each
 * date pays each person, adding up to their net, with the month's deductions
 * taken from the salary payment. Each date gets its own listing and its own
 * recorded transfer. The payslip reaches the employee with the salary; the
 * run reads PAID with the last transfer, and a month with any transfer
 * recorded cannot be reopened. Reopened before that, its listings are
 * withdrawn with the figures they were made from.
 */
describe('one payroll month paid on three dates (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let staffId: string;
  let runId: string;

  const PERIOD = '2026-08';
  const SALARY = '2026-08-30';
  const FEE = '2026-09-01';
  const FIFTEENTH = '2026-09-15';
  const server = () => app.getHttpServer();
  const status = async () => (await request(server()).get(`/workforce/payroll/runs/${runId}/payment`).set('Authorization', bearer).expect(200)).body;
  const record = (payDate: string, reference: string) =>
    request(server())
      .post(`/workforce/payroll/runs/${runId}/payment/record-paid`)
      .set('Authorization', bearer)
      .send({ payDate, paymentDate: payDate, reference });
  const financePayment = async () =>
    (await request(server()).get('/workforce/payroll/finance/liabilities?year=2026').set('Authorization', bearer).expect(200)).body.runs.find(
      (row: { runId: string }) => row.runId === runId,
    ).payment;
  const runStatus = async () =>
    withTenantContext(prisma, tenantId, (tx) => tx.payrollRun.findUniqueOrThrow({ where: { id: runId }, select: { status: true, paymentDate: true } }));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'Three Pay Dates Tenant' } }));
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    const clinicId = (await request(server()).post('/clinics').set('Authorization', bearer).send({ name: 'Pay Dates Clinic' }).expect(201)).body.id;
    const legalEmployerId = (await request(server()).post('/workforce/legal-employers').set('Authorization', bearer).send({ name: 'Pay Dates Sdn Bhd' }).expect(201)).body.id;
    await request(server()).post('/workforce/pay-components/seed').set('Authorization', bearer).expect(201);

    // The clinic's dates, in Settings.
    for (const [code, payDay, payMonthOffset] of [['DIRECTOR_FEE', 1, 1], ['LOCUM_FEE', 15, 1], ['PANEL_CLAIM', 15, 1]] as const) {
      await request(server()).patch(`/workforce/pay-components/${code}/pay-date`).set('Authorization', bearer).send({ payDay, payMonthOffset }).expect(200);
    }

    const staff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Demo Resident', clinicId } }),
    );
    staffId = staff.id;
    await request(server())
      .post(`/workforce/employees/${staffId}`)
      .set('Authorization', bearer)
      .send({
        employeeNo: 'PD-1',
        position: 'Resident doctor',
        employmentType: 'PERMANENT',
        employmentStatus: 'ACTIVE',
        startDate: '2024-01-01',
        dateOfBirth: '1990-05-05',
        bankName: 'Maybank',
        bankAccountNo: '512345678901',
      })
      .expect(201);
    await request(server())
      .post(`/workforce/employees/${staffId}/statutory-classification`)
      .set('Authorization', bearer)
      .send({
        effectiveFrom: '2024-01-01',
        epfMembership: 'MALAYSIAN_CITIZEN',
        taxResidence: 'RESIDENT',
        pcbCategory: 'CATEGORY_1',
        qualifyingChildren: 0,
        restDayOfWeek: 0,
        lindungParticipation: 'NOT_PARTICIPATING',
        reason: 'Recorded at hire',
      })
      .expect(201);
    await request(server()).patch(`/workforce/employees/${staffId}/legal-employer`).set('Authorization', bearer).send({ legalEmployerId }).expect(200);
    await request(server())
      .post(`/workforce/employees/${staffId}/salary`)
      .set('Authorization', bearer)
      .send({ amount: '3000.00', basis: 'MONTHLY', effectiveFrom: '2024-01-01', reason: 'Starting salary' })
      .expect(201);
    for (const [componentCode, amount] of [['DIRECTOR_FEE', '500.00'], ['LOCUM_FEE', '300.00'], ['PANEL_CLAIM', '120.00']] as const) {
      await request(server())
        .post('/workforce/payroll/inputs')
        .set('Authorization', bearer)
        .send({ staffId, period: PERIOD, componentCode, amount, reason: 'This month' })
        .expect(201);
    }

    runId = (await request(server()).post('/workforce/payroll/runs').set('Authorization', bearer).send({ period: PERIOD, clinicId }).expect(201)).body.id;
    await request(server()).patch(`/workforce/payroll/runs/${runId}/calculate`).set('Authorization', bearer).expect(200);
    await request(server()).patch(`/workforce/payroll/runs/${runId}/approve`).set('Authorization', bearer).send({ acknowledgeStatutoryGap: true }).expect(200);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('freezes what each date pays, adding up to the net, with the deductions taken from the salary', async () => {
    const slip = (await request(server()).get(`/workforce/payroll/runs/${runId}/payslips/${staffId}`).set('Authorization', bearer).expect(200)).body;
    const dateOf = (code: string) => slip.earnings.find((line: { code: string }) => line.code === code).payDate;
    expect([dateOf('BASIC'), dateOf('DIRECTOR_FEE'), dateOf('LOCUM_FEE'), dateOf('PANEL_CLAIM')]).toEqual([SALARY, FEE, FIFTEENTH, FIFTEENTH]);

    expect(slip.payments.map((payment: { date: string }) => payment.date)).toEqual([SALARY, FEE, FIFTEENTH]);
    expect(slip.payments.reduce((sum: number, payment: { amountCents: number }) => sum + payment.amountCents, 0)).toBe(slip.figures.netCents);
    // The fee and the 15th are paid whole; everything the month withholds comes off the salary.
    expect(slip.payments[1].amountCents).toBe(50_000);
    expect(slip.payments[2].amountCents).toBe(42_000);
    expect(slip.payments[0].amountCents).toBe(slip.figures.netCents - 92_000);
    expect(slip.payments.every((payment: { paidOn: string | null }) => payment.paidOn === null)).toBe(true);
  });

  it('prepares one reconciled listing per date, and says which carries the salary', async () => {
    const before = await status();
    expect(before.schedule.map((entry: { payDate: string }) => entry.payDate)).toEqual([SALARY, FEE, FIFTEENTH]);
    expect(before.batches).toEqual([]);

    const prepared = (await request(server()).post(`/workforce/payroll/runs/${runId}/payment/prepare`).set('Authorization', bearer).expect(201)).body;
    expect(prepared.batches.map((batch: { payDate: string; carriesSalary: boolean; totalCents: number }) => [batch.payDate, batch.carriesSalary, batch.totalCents])).toEqual(
      prepared.schedule.map((entry: { payDate: string; totalCents: number }) => [entry.payDate, entry.payDate === SALARY, entry.totalCents]),
    );
    expect(prepared.salaryDate).toBe(SALARY);
  });

  it('downloads one date’s listing, and asks which date when not told', async () => {
    const csv = await request(server()).get(`/workforce/payroll/runs/${runId}/payment/listing?payDate=${FIFTEENTH}`).set('Authorization', bearer).expect(200);
    expect(csv.text).toContain(`paid on ${FIFTEENTH}`);
    expect(csv.text).toContain('420.00');
    expect(csv.headers['content-disposition']).toContain(`-paid-${FIFTEENTH}-`);

    const unsaid = await request(server()).get(`/workforce/payroll/runs/${runId}/payment/listing`).set('Authorization', bearer).expect(400);
    expect(unsaid.body.message).toMatch(/paid on 3 dates.*Say which one/);
  });

  it('withdraws the listings when the month is reopened, and pays the dates it is approved with again', async () => {
    await request(server()).patch(`/workforce/payroll/runs/${runId}/reopen`).set('Authorization', bearer).send({ reason: 'The panel claim goes with the salary' }).expect(200);
    expect((await status()).batches).toEqual([]);

    await request(server()).patch('/workforce/pay-components/PANEL_CLAIM/pay-date').set('Authorization', bearer).send({ payDay: 30, payMonthOffset: 0 }).expect(200);
    await request(server()).patch(`/workforce/payroll/runs/${runId}/calculate`).set('Authorization', bearer).expect(200);
    await request(server()).patch(`/workforce/payroll/runs/${runId}/approve`).set('Authorization', bearer).send({ acknowledgeStatutoryGap: true }).expect(200);

    const prepared = (await request(server()).post(`/workforce/payroll/runs/${runId}/payment/prepare`).set('Authorization', bearer).expect(201)).body;
    const rows = prepared.batches.map((batch: { payDate: string; totalCents: number; snapshotVersion: number }) => [batch.payDate, batch.totalCents, batch.snapshotVersion]);
    expect(rows.map((row: unknown[]) => row[0])).toEqual([SALARY, FEE, FIFTEENTH]);
    // The 15th now carries the locum alone; the claim went to the salary.
    expect(rows.slice(1)).toEqual([[FEE, 50_000, 2], [FIFTEENTH, 30_000, 2]]);
    expect(rows[0][2]).toBe(2);
  });

  it('records each transfer on its own: the payslip goes out with the salary, PAID comes with the last', async () => {
    await record(SALARY, 'IBG-SALARY-0830').expect(201);
    expect(await runStatus()).toEqual({ status: 'APPROVED', paymentDate: new Date(`${SALARY}T00:00:00.000Z`) });
    // Finance is not told the month is paid while two of its transfers are not.
    const part = await financePayment();
    expect(part.state).toBe('GENERATED');
    expect(part.stateMeans).toMatch(/1 of the 3 transfers/);

    // The employee sees the month now: their salary has gone out.
    const employee = bearerFor(tenantId, staffId, Role.FRONT_DESK_CLINICAL_STAFF);
    const mine = (await request(server()).get('/me/payslips').set('Authorization', employee).expect(200)).body as { runId: string }[];
    expect(mine.map((row) => row.runId)).toContain(runId);
    const onScreen = (await request(server()).get(`/me/payslips/${runId}`).set('Authorization', employee).expect(200)).body;
    expect(onScreen.payments.map((payment: { date: string; paidOn: string | null }) => [payment.date, payment.paidOn])).toEqual([
      [SALARY, SALARY],
      [FEE, null],
      [FIFTEENTH, null],
    ]);

    // Money has left: the month cannot be reopened as though it had not.
    const refused = await request(server()).patch(`/workforce/payroll/runs/${runId}/reopen`).set('Authorization', bearer).send({ reason: 'Trying to reopen a part-paid month' }).expect(409);
    expect(refused.body.message).toMatch(/transfer for this month was recorded/);

    await record(FEE, 'IBG-FEE-0901').expect(201);
    expect((await runStatus()).status).toBe('APPROVED');
    await record(FEE, 'IBG-FEE-AGAIN').expect(409);

    await record(FIFTEENTH, 'IBG-FIFTEENTH-0915').expect(201);
    expect((await runStatus()).status).toBe('PAID');
    const after = await status();
    expect(after.batches.every((batch: { status: string }) => batch.status === 'RECORDED_PAID')).toBe(true);

    const slip = (await request(server()).get(`/workforce/payroll/runs/${runId}/payslips/${staffId}`).set('Authorization', bearer).expect(200)).body;
    expect(slip.payments.map((payment: { paidOn: string | null }) => payment.paidOn)).toEqual([SALARY, FEE, FIFTEENTH]);

    // Every date is paid: nothing is left to prepare.
    await request(server()).post(`/workforce/payroll/runs/${runId}/payment/prepare`).set('Authorization', bearer).expect(409);

    // The payment status report: one listing per date, the ones withdrawn at the reopen kept as superseded.
    const report = (await request(server()).get(`/workforce/payroll/runs/${runId}/reports/payment-status`).set('Authorization', bearer).expect(200)).body;
    expect(report.listings.map((listing: { payDate: string; status: string }) => [listing.payDate, listing.status])).toEqual([
      [SALARY, 'RECORDED_PAID'],
      [FEE, 'RECORDED_PAID'],
      [FIFTEENTH, 'RECORDED_PAID'],
    ]);
    expect(report.current.payDate).toBe(SALARY);

    const paid = await financePayment();
    expect(paid.state).toBe('RECORDED_PAID');
    expect(paid.transfers.map((transfer: { payDate: string }) => transfer.payDate)).toEqual([SALARY, FEE, FIFTEENTH]);
    expect(paid.paymentReference).toBe('IBG-SALARY-0830 · IBG-FEE-0901 · IBG-FIFTEENTH-0915');
    expect(paid.paymentDate).toBe(FIFTEENTH);
    expect(report.supersededBatches.map((batch: { status: string }) => batch.status)).toEqual(['SUPERSEDED', 'SUPERSEDED', 'SUPERSEDED']);
  });
});
