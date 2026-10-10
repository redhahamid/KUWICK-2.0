import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { bearerFor, createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();

/**
 * A PAY DATE IN THE FOLLOWING MONTH (UAT, 10 October 2026): "salary paid on
 * the 1st of the following month, or the 25th of this month".
 *
 * August's salary goes out on 1 September; a panel claim on the 15th of
 * August. The statutory figures stay on August. The salary transfer is the
 * one that releases the payslip, on its own date, and the run reads PAID once
 * both are recorded.
 */
describe('a pay date in the following month (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let staffId: string;
  let runId: string;

  const server = () => app.getHttpServer();
  const status = async () => (await request(server()).get(`/workforce/payroll/runs/${runId}/payment`).set('Authorization', bearer).expect(200)).body;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'Following Month Tenant' } }));
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    const clinicId = (await request(server()).post('/clinics').set('Authorization', bearer).send({ name: 'Following Month Clinic' }).expect(201)).body.id;
    const legalEmployerId = (await request(server()).post('/workforce/legal-employers').set('Authorization', bearer).send({ name: 'Following Month Sdn Bhd' }).expect(201)).body.id;
    await request(server()).post('/workforce/pay-components/seed').set('Authorization', bearer).expect(201);
    const basic = await request(server())
      .patch('/workforce/pay-components/BASIC/pay-date')
      .set('Authorization', bearer)
      .send({ payDay: 1, paidFollowingMonth: true })
      .expect(200);
    expect(basic.body).toMatchObject({ code: 'BASIC', payDay: 1, paidInArrears: false, paidFollowingMonth: true });
    await request(server()).patch('/workforce/pay-components/PANEL_CLAIM/pay-date').set('Authorization', bearer).send({ payDay: 15 }).expect(200);

    staffId = (
      await withTenantContext(prisma, tenantId, (tx) =>
        tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Demo Resident', clinicId } }),
      )
    ).id;
    await request(server())
      .post(`/workforce/employees/${staffId}`)
      .set('Authorization', bearer)
      .send({
        employeeNo: 'FM-1',
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
    await request(server())
      .post('/workforce/payroll/inputs')
      .set('Authorization', bearer)
      .send({ staffId, period: '2026-08', componentCode: 'PANEL_CLAIM', amount: '120.00', reason: 'This month' })
      .expect(201);

    runId = (await request(server()).post('/workforce/payroll/runs').set('Authorization', bearer).send({ period: '2026-08', clinicId }).expect(201)).body.id;
    await request(server()).patch(`/workforce/payroll/runs/${runId}/calculate`).set('Authorization', bearer).expect(200);
    await request(server()).patch(`/workforce/payroll/runs/${runId}/approve`).set('Authorization', bearer).send({ acknowledgeStatutoryGap: true }).expect(200);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('lists the item as paid on a day of the following month', async () => {
    const items = (await request(server()).get('/workforce/pay-components').set('Authorization', bearer).expect(200)).body.components;
    expect(items.find((row: { code: string }) => row.code === 'BASIC')).toMatchObject({ payDay: 1, paidFollowingMonth: true });
    expect(items.find((row: { code: string }) => row.code === 'PANEL_CLAIM')).toMatchObject({ payDay: 15, paidFollowingMonth: false });
  });

  it('pays August’s salary on 1 September, with the month’s deductions taken from it', async () => {
    const slip = (await request(server()).get(`/workforce/payroll/runs/${runId}/payslips/${staffId}`).set('Authorization', bearer).expect(200)).body;
    expect(slip.period).toBe('2026-08');
    const dateOf = (code: string) => slip.earnings.find((line: { code: string }) => line.code === code).payDate;
    expect([dateOf('BASIC'), dateOf('PANEL_CLAIM')]).toEqual(['2026-09-01', '2026-08-15']);
    expect(slip.payments.map((payment: { date: string; amountCents: number }) => [payment.date, payment.amountCents])).toEqual([
      ['2026-08-15', 12_000],
      ['2026-09-01', slip.figures.netCents - 12_000],
    ]);

    const before = await status();
    expect(before.salaryDate).toBe('2026-09-01');
    expect(before.schedule.map((entry: { payDate: string }) => entry.payDate)).toEqual(['2026-08-15', '2026-09-01']);
  });

  it('releases the payslip with the salary transfer, on its own date', async () => {
    await request(server()).post(`/workforce/payroll/runs/${runId}/payment/prepare`).set('Authorization', bearer).expect(201);
    const record = (payDate: string) =>
      request(server())
        .post(`/workforce/payroll/runs/${runId}/payment/record-paid`)
        .set('Authorization', bearer)
        .send({ payDate, paymentDate: payDate, reference: `IBG-${payDate}` })
        .expect(201);
    await record('2026-09-01');
    const run = await withTenantContext(prisma, tenantId, (tx) => tx.payrollRun.findUniqueOrThrow({ where: { id: runId }, select: { status: true, paymentDate: true } }));
    expect(run).toEqual({ status: 'APPROVED', paymentDate: new Date('2026-09-01T00:00:00.000Z') });
    const employee = bearerFor(tenantId, staffId, Role.FRONT_DESK_CLINICAL_STAFF);
    const mine = (await request(server()).get('/me/payslips').set('Authorization', employee).expect(200)).body as { runId: string }[];
    expect(mine.map((row) => row.runId)).toContain(runId);

    await record('2026-08-15');
    expect((await status()).runStatus).toBe('PAID');
  });
});
