import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { bearerFor, createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();

/**
 * A DOCUMENT IS NOT A TRANSFER.
 *
 * The batch is composed from the approved snapshot and must reconcile to the
 * cent — included plus excluded equals the approved net — or it is refused.
 * An employee with no bank account is an EXCLUDED ROW with a reason, never a
 * silent omission. And nothing reads "paid" until a human records the
 * transfer with a date and a bank reference.
 */
describe('Payroll payment preparation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;
  let legalEmployerId: string;
  let bankedId: string;
  let unbankedId: string;
  let runId: string;

  const PERIOD = '2026-07';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, name: 'Payment Tenant' } }),
    );
    const owner = await createOwnerAndBearer(prisma, tenantId);
    bearer = owner.bearer;

    const clinic = await request(app.getHttpServer())
      .post('/clinics')
      .set('Authorization', bearer)
      .send({ name: 'Payment Clinic' })
      .expect(201);
    clinicId = clinic.body.id;

    const employer = await request(app.getHttpServer())
      .post('/workforce/legal-employers')
      .set('Authorization', bearer)
      .send({ name: 'Payment Employer Sdn Bhd' })
      .expect(201);
    legalEmployerId = employer.body.id;

    await request(app.getHttpServer())
      .post('/workforce/pay-components/seed')
      .set('Authorization', bearer)
      .expect(201);

    const make = async (name: string, salary: string, banked: boolean) => {
      const staff = await withTenantContext(prisma, tenantId, (tx) =>
        tx.staff.create({
          data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: name, clinicId },
        }),
      );
      await request(app.getHttpServer())
        .post(`/workforce/employees/${staff.id}`)
        .set('Authorization', bearer)
        .send({
          employeeNo: `P-${Math.floor(Math.random() * 100000)}`,
          position: 'Clinic Assistant',
          employmentType: 'PERMANENT',
          employmentStatus: 'ACTIVE',
          startDate: '2024-01-01',
          dateOfBirth: '1992-04-19',
          ...(banked ? { bankName: 'Maybank', bankAccountNo: '512345678901' } : {}),
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/workforce/employees/${staff.id}/statutory-classification`)
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
      await request(app.getHttpServer())
        .patch(`/workforce/employees/${staff.id}/legal-employer`)
        .set('Authorization', bearer)
        .send({ legalEmployerId })
        .expect(200);
      await request(app.getHttpServer())
        .post(`/workforce/employees/${staff.id}/salary`)
        .set('Authorization', bearer)
        .send({ amount: salary, basis: 'MONTHLY', effectiveFrom: '2024-01-01', reason: 'Starting salary' })
        .expect(201);
      return staff.id;
    };

    bankedId = await make('Banked Person', '3200.00', true);
    unbankedId = await make('Cash Person', '2600.00', false);

    const run = await request(app.getHttpServer())
      .post('/workforce/payroll/runs')
      .set('Authorization', bearer)
      .send({ period: PERIOD, clinicId })
      .expect(201);
    runId = run.body.id;
    await request(app.getHttpServer())
      .patch(`/workforce/payroll/runs/${runId}/calculate`)
      .set('Authorization', bearer)
      .expect(200);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('refuses to prepare payment for a run nobody has approved', async () => {
    const res = await request(app.getHttpServer())
      .post(`/workforce/payroll/runs/${runId}/payment/prepare`)
      .set('Authorization', bearer)
      .expect(409);
    expect(res.body.message).toMatch(/APPROVED run/);
  });

  it('prepares a reconciled batch: exclusions named, total exact', async () => {
    // The missing-bank warning is overridable; pass it so the run can approve.
    const gate = await request(app.getHttpServer())
      .get(`/workforce/payroll/runs/${runId}/exceptions`)
      .set('Authorization', bearer)
      .expect(200);
    for (const row of gate.body.exceptions as { id: string; code: string }[]) {
      if (row.code === 'NO_BANK_DETAILS') {
        await request(app.getHttpServer())
          .patch(`/workforce/payroll/exceptions/${row.id}/override`)
          .set('Authorization', bearer)
          .send({ reason: 'Paid in cash while their account is opened' })
          .expect(200);
      }
    }
    await request(app.getHttpServer())
      .patch(`/workforce/payroll/runs/${runId}/approve`)
      .set('Authorization', bearer)
      .send({ acknowledgeStatutoryGap: true })
      .expect(200);

    const prepared = await request(app.getHttpServer())
      .post(`/workforce/payroll/runs/${runId}/payment/prepare`)
      .set('Authorization', bearer)
      .expect(201);

    const batch = prepared.body.batch;
    expect(batch.status).toBe('GENERATED');
    expect(batch.includedCount).toBe(1);
    expect(batch.excludedCount).toBe(1);

    const included = batch.lines.find((line: { staffId: string }) => line.staffId === bankedId);
    const excluded = batch.lines.find((line: { staffId: string }) => line.staffId === unbankedId);
    expect(included.included).toBe(true);
    // The status read shows the account ENDING only; the full number stays in
    // the export behind hr.payroll.export.bank.
    expect(included.accountEnding).toBe('8901');
    expect(included.bankAccountNo).toBeUndefined();
    expect(excluded.included).toBe(false);
    expect(excluded.exclusionReason).toMatch(/No bank account/);

    // Included total is exactly the included line; batch total plus the
    // excluded net is the run's approved net.
    expect(batch.totalCents).toBe(included.amountCents);
    const detail = await request(app.getHttpServer())
      .get(`/workforce/payroll/runs/${runId}`)
      .set('Authorization', bearer)
      .expect(200);
    expect(batch.totalCents + excluded.amountCents).toBe(Math.round(Number(detail.body.netTotal) * 100));
  });

  it('downloads an instruction listing that says what it is NOT', async () => {
    const res = await request(app.getHttpServer())
      .get(`/workforce/payroll/runs/${runId}/payment/listing`)
      .set('Authorization', bearer)
      .expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const body = res.text;
    expect(body).toContain('NOT a bank file');
    expect(body).toContain('Banked Person');
    expect(body).toContain('512345678901');
    expect(body).toContain('EXCLUDED');
    expect(body).toContain('TOTAL TO PAY');

    const status = await request(app.getHttpServer())
      .get(`/workforce/payroll/runs/${runId}/payment`)
      .set('Authorization', bearer)
      .expect(200);
    expect(status.body.batch.status).toBe('DOWNLOADED');
    // Downloading a document never claims money moved.
    expect(status.body.runStatus).toBe('APPROVED');
    expect(status.body.batch.paidRecordedAt).toBeNull();
  });

  it('refuses to record a payment without the transfer reference', async () => {
    await request(app.getHttpServer())
      .post(`/workforce/payroll/runs/${runId}/payment/record-paid`)
      .set('Authorization', bearer)
      .send({ paymentDate: '2026-07-28', reference: '' })
      .expect(409);
  });

  it('records the transfer — the only path to "paid" — and marks the run PAID', async () => {
    const res = await request(app.getHttpServer())
      .post(`/workforce/payroll/runs/${runId}/payment/record-paid`)
      .set('Authorization', bearer)
      .send({ paymentDate: '2026-07-28', reference: 'IBG-20260728-000123' })
      .expect(201);
    expect(res.body.batch.status).toBe('RECORDED_PAID');
    expect(res.body.batch.paymentReference).toBe('IBG-20260728-000123');
    expect(res.body.runStatus).toBe('PAID');

    const audit = await withTenantContext(prisma, tenantId, (tx) =>
      tx.auditLog.findMany({ where: { tenantId, action: 'payrollPayment.recordedPaid' } }),
    );
    expect(audit).toHaveLength(1);
  });

  it('refuses a second batch once a payment is recorded — that is a double payment', async () => {
    const res = await request(app.getHttpServer())
      .post(`/workforce/payroll/runs/${runId}/payment/prepare`)
      .set('Authorization', bearer)
      .expect(409);
    expect(res.body.message).toMatch(/double\s?payment/i);
  });

  it('keeps the whole payment surface behind permissions', async () => {
    const outsider = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({
        data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Not Payroll', clinicId },
      }),
    );
    const outsiderBearer = bearerFor(tenantId, outsider.id, Role.FRONT_DESK_CLINICAL_STAFF);
    await request(app.getHttpServer())
      .get(`/workforce/payroll/runs/${runId}/payment`)
      .set('Authorization', outsiderBearer)
      .expect(403);
    await request(app.getHttpServer())
      .post(`/workforce/payroll/runs/${runId}/payment/prepare`)
      .set('Authorization', outsiderBearer)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/workforce/payroll/runs/${runId}/payment/listing`)
      .set('Authorization', outsiderBearer)
      .expect(403);
  });
});
