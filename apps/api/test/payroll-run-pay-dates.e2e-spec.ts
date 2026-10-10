import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { bearerFor, createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();

/**
 * THE OWNER'S PAY DATES FOR ONE RUN (UAT, 10 October 2026): "The component's
 * Paid on (e.g. 15th, 1st) is only the default date within that run's month,
 * and can be changed on the Pay step for each run before the listing is
 * prepared."
 *
 * A director's fee due on the 1st, a panel claim on the 15th and the salary
 * on the 30th. The owner moves the fee to the 28th for this run: the listing,
 * the payslip and the employee's portal follow, and Payroll items keep their
 * own day. Two dates on one day are one transfer, and undone in one step. A
 * date stands once its listing is prepared, and a paid run's dates are the
 * dates the money went.
 */
describe('the owner chooses the pay dates for one run (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let staffId: string;
  let runId: string;

  const PERIOD = '2026-08';
  const FEE = '2026-08-01';
  const FIFTEENTH = '2026-08-15';
  const SALARY = '2026-08-30';
  const server = () => app.getHttpServer();
  const status = async () => (await request(server()).get(`/workforce/payroll/runs/${runId}/payment`).set('Authorization', bearer).expect(200)).body;
  const choose = (defaultDate: string, payDate: string, as = bearer) =>
    request(server()).patch(`/workforce/payroll/runs/${runId}/payment/dates`).set('Authorization', as).send({ defaultDate, payDate });
  const slip = async () => (await request(server()).get(`/workforce/payroll/runs/${runId}/payslips/${staffId}`).set('Authorization', bearer).expect(200)).body;
  const dates = (body: { schedule: { payDate: string }[] }) => body.schedule.map((entry) => entry.payDate);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'Run Pay Dates Tenant' } }));
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    const clinicId = (await request(server()).post('/clinics').set('Authorization', bearer).send({ name: 'Run Pay Dates Clinic' }).expect(201)).body.id;
    const legalEmployerId = (await request(server()).post('/workforce/legal-employers').set('Authorization', bearer).send({ name: 'Run Pay Dates Sdn Bhd' }).expect(201)).body.id;
    await request(server()).post('/workforce/pay-components/seed').set('Authorization', bearer).expect(201);
    for (const [code, payDay, paidInArrears] of [['DIRECTOR_FEE', 1, true], ['PANEL_CLAIM', 15, false]] as const) {
      await request(server()).patch(`/workforce/pay-components/${code}/pay-date`).set('Authorization', bearer).send({ payDay, paidInArrears }).expect(200);
    }

    const staff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Demo Resident', clinicId } }),
    );
    staffId = staff.id;
    await request(server())
      .post(`/workforce/employees/${staffId}`)
      .set('Authorization', bearer)
      .send({
        employeeNo: 'RPD-1',
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
    for (const [componentCode, amount] of [['DIRECTOR_FEE', '500.00'], ['PANEL_CLAIM', '120.00']] as const) {
      await request(server())
        .post('/workforce/payroll/inputs')
        .set('Authorization', bearer)
        .send({ staffId, period: PERIOD, componentCode, amount, reason: 'This month' })
        .expect(201);
    }

    runId = (await request(server()).post('/workforce/payroll/runs').set('Authorization', bearer).send({ period: PERIOD, clinicId }).expect(201)).body.id;
    await request(server()).patch(`/workforce/payroll/runs/${runId}/calculate`).set('Authorization', bearer).expect(200);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('is chosen for an approved run only', async () => {
    const draft = await choose(FEE, '2026-08-28').expect(409);
    expect(draft.body.message).toMatch(/approved run/);
    await request(server()).patch(`/workforce/payroll/runs/${runId}/approve`).set('Authorization', bearer).send({ acknowledgeStatutoryGap: true }).expect(200);
  });

  it("lists the record's own dates from Payroll items, each with the date it goes out on", async () => {
    const before = await status();
    expect(before.mayChooseDates).toBe(true);
    expect(before.payDateRange).toEqual({ from: '2026-08-01', to: '2026-09-30' });
    expect(before.payDates.map((row: { defaultDate: string; payDate: string; locked: boolean }) => [row.defaultDate, row.payDate, row.locked])).toEqual([
      [FEE, FEE, false],
      [FIFTEENTH, FIFTEENTH, false],
      [SALARY, SALARY, false],
    ]);
    expect(before.payDates[0]).toMatchObject({ items: ["Director's fee (July 2026)"], totalCents: 50_000 });
    expect(before.payDates[1]).toMatchObject({ items: ['Panel claim'], totalCents: 12_000 });
  });

  it('moves a date for this run alone: the listing, the payslip and the portal follow, Payroll items keep their day', async () => {
    const moved = (await choose(FEE, '2026-08-28').expect(200)).body;
    expect(moved.changed).toBe(true);
    expect(dates(moved)).toEqual([FIFTEENTH, '2026-08-28', SALARY]);
    expect(moved.payDates[0]).toMatchObject({ defaultDate: FEE, payDate: '2026-08-28' });

    const payslip = await slip();
    expect(payslip.earnings.find((line: { code: string }) => line.code === 'DIRECTOR_FEE').payDate).toBe('2026-08-28');
    expect(payslip.payments.map((payment: { date: string; amountCents: number }) => [payment.date, payment.amountCents])).toEqual([
      [FIFTEENTH, 12_000],
      ['2026-08-28', 50_000],
      [SALARY, payslip.figures.netCents - 62_000],
    ]);

    // Choosing the date it already has changes nothing.
    expect((await choose(FEE, '2026-08-28').expect(200)).body.changed).toBe(false);

    const items = (await request(server()).get('/workforce/pay-components').set('Authorization', bearer).expect(200)).body.components;
    expect(items.find((row: { code: string }) => row.code === 'DIRECTOR_FEE')).toMatchObject({ payDay: 1, paidInArrears: true });

    const audit = await withTenantContext(prisma, tenantId, (tx) =>
      tx.auditLog.findMany({ where: { tenantId, action: 'payrollPayment.payDateChosen', entityId: runId } }),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].before).toEqual({ defaultDate: FEE, payDate: FEE });
    expect(audit[0].after).toMatchObject({ defaultDate: FEE, payDate: '2026-08-28', totalCents: 50_000 });
  });

  it('makes two dates on one day one transfer, and undoes it by choosing the default again', async () => {
    const merged = (await choose(FIFTEENTH, SALARY).expect(200)).body;
    expect(dates(merged)).toEqual(['2026-08-28', SALARY]);
    const payslip = await slip();
    expect(payslip.payments.map((payment: { date: string; amountCents: number }) => [payment.date, payment.amountCents])).toEqual([
      ['2026-08-28', 50_000],
      [SALARY, payslip.figures.netCents - 50_000],
    ]);

    const apart = (await choose(FIFTEENTH, FIFTEENTH).expect(200)).body;
    expect(dates(apart)).toEqual([FIFTEENTH, '2026-08-28', SALARY]);
    const stored = await withTenantContext(prisma, tenantId, (tx) => tx.payrollRun.findUniqueOrThrow({ where: { id: runId }, select: { payDates: true } }));
    expect(stored.payDates).toEqual({ [FEE]: '2026-08-28' });
  });

  it('refuses a date outside the run’s month and the next, a date the run pays nothing on, and a caller who may not prepare listings', async () => {
    const far = await choose(FEE, '2027-08-28').expect(400);
    expect(far.body.message).toMatch(/Choose a date from 2026-08-01 to 2026-09-30/);
    const nothing = await choose('2026-08-02', '2026-08-03').expect(400);
    expect(nothing.body.message).toMatch(/Nothing in this run is due on 2026-08-02/);
    await choose(FEE, 'next Friday').expect(400);
    await choose(FEE, '2026-08-27', bearerFor(tenantId, staffId, Role.FRONT_DESK_CLINICAL_STAFF)).expect(403);
  });

  it('keeps a date once its listing is prepared, and pays the salary on the date chosen for it', async () => {
    await choose(SALARY, '2026-08-31').expect(200);
    const prepared = (await request(server()).post(`/workforce/payroll/runs/${runId}/payment/prepare`).set('Authorization', bearer).expect(201)).body;
    expect(prepared.batches.map((batch: { payDate: string; carriesSalary: boolean }) => [batch.payDate, batch.carriesSalary])).toEqual([
      [FIFTEENTH, false],
      ['2026-08-28', false],
      ['2026-08-31', true],
    ]);
    expect(prepared.payDates.every((row: { locked: boolean }) => row.locked)).toBe(true);

    const locked = await choose(FEE, '2026-08-27').expect(409);
    expect(locked.body.message).toMatch(/listing for 2026-08-28 is prepared/);

    for (const [payDate, reference] of [['2026-08-31', 'IBG-SALARY-0831'], ['2026-08-28', 'IBG-FEE-0828'], [FIFTEENTH, 'IBG-CLAIM-0815']] as const) {
      await request(server())
        .post(`/workforce/payroll/runs/${runId}/payment/record-paid`)
        .set('Authorization', bearer)
        .send({ payDate, paymentDate: payDate, reference })
        .expect(201);
    }
    const run = await withTenantContext(prisma, tenantId, (tx) => tx.payrollRun.findUniqueOrThrow({ where: { id: runId }, select: { status: true, paymentDate: true } }));
    expect(run).toEqual({ status: 'PAID', paymentDate: new Date('2026-08-31T00:00:00.000Z') });

    const employee = bearerFor(tenantId, staffId, Role.FRONT_DESK_CLINICAL_STAFF);
    const onScreen = (await request(server()).get(`/me/payslips/${runId}`).set('Authorization', employee).expect(200)).body;
    expect(onScreen.payments.map((payment: { date: string; paidOn: string | null }) => [payment.date, payment.paidOn])).toEqual([
      [FIFTEENTH, FIFTEENTH],
      ['2026-08-28', '2026-08-28'],
      ['2026-08-31', '2026-08-31'],
    ]);

    const paid = await choose(FEE, '2026-08-27').expect(409);
    expect(paid.body.message).toMatch(/This run is paid/);
    expect((await status()).mayChooseDates).toBe(false);
  });
});
