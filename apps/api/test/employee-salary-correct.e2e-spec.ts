import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { bearerFor, createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();

/**
 * CORRECT OR DELETE A SALARY ROW (UAT, 14 October 2026). The real case, with
 * demo people: 1 Jan 2026 RM1,900; 1 Jun 2026 RM2,000 keyed instead of
 * RM2,100; 1 Nov 2026 RM2,100 added by mistake trying to fix it. "Correct"
 * changes a row's amount and basis, "Delete" removes one and the row before
 * runs on; both need a reason, are logged, and are refused while an approved
 * month for this employee falls inside the row, naming it.
 */
describe('correcting and deleting salary rows (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;
  let legalEmployerId: string;
  let staffId: string;
  const runs: Record<string, string> = {};

  const server = () => app.getHttpServer();
  const history = async () =>
    (await request(server()).get(`/workforce/employees/${staffId}/salary`).set('Authorization', bearer).expect(200)).body as {
      id: string;
      amount: string;
      effectiveFrom: string;
      effectiveTo: string | null;
      reason: string | null;
    }[];
  const rowFrom = async (day: string) => (await history()).find((row) => row.effectiveFrom === day)!;
  const correct = (id: string, body: Record<string, unknown>, auth = bearer) =>
    request(server()).patch(`/workforce/employees/${staffId}/salary/${id}`).set('Authorization', auth).send(body);
  const remove = (id: string, body: Record<string, unknown>) =>
    request(server()).delete(`/workforce/employees/${staffId}/salary/${id}`).set('Authorization', bearer).send(body);
  const audit = (action: string) => withTenantContext(prisma, tenantId, (tx) => tx.auditLog.findMany({ where: { action }, orderBy: { createdAt: 'asc' } }));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, name: 'Salary Correction Tenant' } }),
    );
    const owner = await createOwnerAndBearer(prisma, tenantId);
    bearer = owner.bearer;

    const clinic = await request(app.getHttpServer())
      .post('/clinics')
      .set('Authorization', bearer)
      .send({ name: 'Payslip Clinic' })
      .expect(201);
    clinicId = clinic.body.id;

    const employer = await request(app.getHttpServer())
      .post('/workforce/legal-employers')
      .set('Authorization', bearer)
      .send({ name: 'Payslip Employer Sdn Bhd', registrationNo: '202601012345', epfEmployerNo: 'EPF-EMP-9' })
      .expect(201);
    legalEmployerId = employer.body.id;

    await request(app.getHttpServer())
      .post('/workforce/pay-components/seed')
      .set('Authorization', bearer)
      .expect(201);

    const staff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({
        data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Payslip Person', clinicId },
      }),
    );
    staffId = staff.id;
    await request(app.getHttpServer())
      .post(`/workforce/employees/${staffId}`)
      .set('Authorization', bearer)
      .send({
        employeeNo: 'PS-001',
        position: 'Clinic Assistant',
        employmentType: 'PERMANENT',
        employmentStatus: 'ACTIVE',
        startDate: '2024-01-01',
        dateOfBirth: '1992-04-19',
        epfNumber: 'EPF-123',
        socsoNumber: 'SOCSO-456',
        bankName: 'Maybank',
        bankAccountNo: '512345678901',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/workforce/employees/${staffId}/statutory-classification`)
      .set('Authorization', bearer)
      .send({
        effectiveFrom: '2024-01-01',
        epfMembership: 'MALAYSIAN_CITIZEN',
        taxResidence: 'RESIDENT',
        pcbCategory: 'CATEGORY_1',
        qualifyingChildren: 0,
        restDayOfWeek: 0,
        lindungParticipation: 'ENROLLED',
        reason: 'Recorded at hire',
      })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/workforce/employees/${staffId}/legal-employer`)
      .set('Authorization', bearer)
      .send({ legalEmployerId })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/workforce/employees/${staffId}/salary`)
      .set('Authorization', bearer)
      .send({ amount: '1900.00', basis: 'MONTHLY', effectiveFrom: '2026-01-01', reason: 'Starting salary' })
      .expect(201);
    for (const [amount, effectiveFrom] of [['2000.00', '2026-06-01'], ['2100.00', '2026-11-01']]) {
      await request(server()).post(`/workforce/employees/${staffId}/salary`).set('Authorization', bearer).send({ amount, effectiveFrom, reason: 'Increment' }).expect(201);
    }


    for (const period of ['2026-05', '2026-06']) {
      runs[period] = (await request(server()).post('/workforce/payroll/runs').set('Authorization', bearer).send({ period, clinicId }).expect(201)).body.id;
      await request(server()).patch(`/workforce/payroll/runs/${runs[period]}/calculate`).set('Authorization', bearer).expect(200);
      await request(server()).patch(`/workforce/payroll/runs/${runs[period]}/approve`).set('Authorization', bearer).send({ acknowledgeStatutoryGap: true }).expect(200);
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('needs a reason, and somebody who manages employees and sees payroll', async () => {
    const june = await rowFrom('2026-06-01');
    expect((await correct(june.id, { amount: '2100.00', reason: ' ' }).expect(400)).body.message).toMatch(/Say why/);
    expect((await correct(june.id, { amount: '2000.00', reason: 'Keying error' }).expect(400)).body.message).toMatch(/already on record/);
    await correct(june.id, { amount: '2100.00', reason: 'Keying error' }, bearerFor(tenantId, staffId, Role.FRONT_DESK_CLINICAL_STAFF)).expect(403);
  });

  it('deletes the row added by mistake; the row before it runs on, logged', async () => {
    const november = await rowFrom('2026-11-01');
    expect((await remove(november.id, {}).expect(400)).body.message).toMatch(/Say why/);
    await remove(november.id, { reason: 'Added by mistake while fixing June' }).expect(200);
    const rows = await history();
    expect(rows.map((row) => [row.effectiveFrom, row.amount, row.effectiveTo])).toEqual([
      ['2026-06-01', '2000.00', null],
      ['2026-01-01', '1900.00', '2026-05-31'],
    ]);
    // The row that runs on says why (UAT, 15 October 2026).
    expect(rows[0].reason).toBe('Increment. The row from 2026-11-01 was deleted: Added by mistake while fixing June');
    const [logged] = await audit('employeeSalary.deleted');
    expect(logged.before).toMatchObject({ amount: '2100.00', effectiveFrom: '2026-11-01', effectiveTo: null });
    expect(logged.after).toMatchObject({ runsOn: { amount: '2000.00', effectiveFrom: '2026-06-01' }, effectiveTo: null, _actor: { staffId: expect.any(String) } });
    expect(JSON.stringify(logged.after)).toMatch(/Added by mistake while fixing June/);
  });

  it('refuses to correct a row an approved month is paid from, naming it; after reopening, corrects it', async () => {
    const june = await rowFrom('2026-06-01');
    const refused = await correct(june.id, { amount: '2100.00', reason: 'Keying error: RM2,100 agreed' }).expect(409);
    expect(refused.body.message).toMatch(/^Jun 2026 is approved for this employee.*Nothing was changed\. Reopen that month/);
    expect((await rowFrom('2026-06-01')).amount).toBe('2000.00');

    await request(server()).patch(`/workforce/payroll/runs/${runs['2026-06']}/reopen`).set('Authorization', bearer).send({ reason: 'Correct no. 42 salary' }).expect(200);
    await correct(june.id, { amount: '2100.00', reason: 'Keying error: RM2,100 agreed' }).expect(200);
    expect((await rowFrom('2026-06-01')).amount).toBe('2100.00');
    // The Reason column says it was corrected, and why (UAT, 15 October 2026).
    expect((await rowFrom('2026-06-01')).reason).toMatch(/Corrected: Keying error: RM2,100 agreed$/);
    const [logged] = await audit('employeeSalary.corrected');
    expect(logged.before).toMatchObject({ amount: '2000.00', basis: 'MONTHLY' });
    expect(logged.after).toMatchObject({ amount: '2100.00', basis: 'MONTHLY' });
    expect(JSON.stringify(logged.after)).toMatch(/Keying error: RM2,100 agreed/);
  });

  it('refuses the January row, which pays approved May, for a correction or a delete', async () => {
    const january = await rowFrom('2026-01-01');
    expect((await correct(january.id, { amount: '1950.00', reason: 'Check' }).expect(409)).body.message).toMatch(/^May 2026 is approved/);
    expect((await remove(january.id, { reason: 'Check' }).expect(409)).body.message).toMatch(/^May 2026 is approved/);
    expect((await history()).length).toBe(2);
  });
});
