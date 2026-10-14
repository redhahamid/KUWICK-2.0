import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { bearerFor, createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();

/**
 * PREVIEW PAYSLIPS (UAT, 14 October 2026): "so payslips can be reviewed
 * without downloading each PDF". The draft on Review, the approved ones on
 * Pay; one combined PDF; and "Mark as checked" per payslip that holds only at
 * the figures it was made at. Demo people only.
 */
describe('payslip preview (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;
  let legalEmployerId: string;
  let staffId: string;
  let secondId: string;
  let runId: string;

  const server = () => app.getHttpServer();
  const list = () => request(server()).get(`/workforce/payroll/runs/${runId}/payslip-preview`).set('Authorization', bearer).expect(200);
  const check = (who: string, checked: boolean, auth = bearer) =>
    request(server()).put(`/workforce/payroll/runs/${runId}/payslip-preview/${who}/check`).set('Authorization', auth).send({ checked });
  const calculate = () => request(server()).patch(`/workforce/payroll/runs/${runId}/calculate`).set('Authorization', bearer).expect(200);
  const pages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, name: 'Preview Tenant' } }),
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
      .send({ amount: '3200.00', basis: 'MONTHLY', effectiveFrom: '2024-01-01', reason: 'Starting salary' })
      .expect(201);

    const second = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Another Demo Person', clinicId } }),
    );
    secondId = second.id;
    await request(server())
      .post(`/workforce/employees/${secondId}`)
      .set('Authorization', bearer)
      .send({ employeeNo: 'PS-002', position: 'Clinic Assistant', employmentType: 'PERMANENT', employmentStatus: 'ACTIVE', startDate: '2024-01-01', dateOfBirth: '1994-02-11' })
      .expect(201);
    await request(server())
      .post(`/workforce/employees/${secondId}/statutory-classification`)
      .set('Authorization', bearer)
      .send({ effectiveFrom: '2024-01-01', epfMembership: 'MALAYSIAN_CITIZEN', taxResidence: 'RESIDENT', pcbCategory: 'CATEGORY_1', qualifyingChildren: 0, restDayOfWeek: 0, lindungParticipation: 'ENROLLED', reason: 'Recorded at hire' })
      .expect(201);
    await request(server()).patch(`/workforce/employees/${secondId}/legal-employer`).set('Authorization', bearer).send({ legalEmployerId }).expect(200);
    await request(server())
      .post(`/workforce/employees/${secondId}/salary`)
      .set('Authorization', bearer)
      .send({ amount: '2800.00', basis: 'MONTHLY', effectiveFrom: '2024-01-01', reason: 'Starting salary' })
      .expect(201);

    runId = (await request(server()).post('/workforce/payroll/runs').set('Authorization', bearer).send({ period: '2026-08', clinicId }).expect(201)).body.id;
    await calculate();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('lists the draft payslips, nobody checked yet', async () => {
    const body = (await list()).body;
    expect(body).toMatchObject({ draft: true, revision: null, period: '2026-08', checked: 0, total: 2 });
    expect(body.payslips.map((row: { name: string }) => row.name)).toEqual(['Another Demo Person', 'Payslip Person']);
    expect(body.payslips[1]).toMatchObject({ employeeNo: 'PS-001', checked: null, changedSinceCheck: false });
  });

  it('shows one draft payslip inline, on the audit trail as viewed', async () => {
    const res = await request(server()).get(`/workforce/payroll/runs/${runId}/payslip-preview/${staffId}/pdf`).set('Authorization', bearer).expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/^inline/);
    expect(pages(res.body)).toBe(1);
    const audit = await withTenantContext(prisma, tenantId, (tx) => tx.auditLog.findMany({ where: { action: 'payrollPayslip.viewed', entityId: runId } }));
    expect(audit.map((row) => row.after)).toEqual([expect.objectContaining({ staffId, draft: true, preview: true })]);
  });

  it('marks a payslip as checked, for somebody who runs or approves payroll only', async () => {
    const clerk = bearerFor(tenantId, secondId, Role.FRONT_DESK_CLINICAL_STAFF);
    await check(staffId, true, clerk).expect(403);
    const done = (await check(staffId, true).expect(200)).body;
    expect(done.checked.by).toBeTruthy();
    const body = (await list()).body;
    expect(body.checked).toBe(1);
    expect(body.payslips.find((row: { staffId: string }) => row.staffId === staffId).checked).toMatchObject({ by: done.checked.by });
  });

  it('un-checks it when the figures move afterwards, saying so', async () => {
    await request(server())
      .post(`/workforce/employees/${staffId}/salary`)
      .set('Authorization', bearer)
      .send({ amount: '3400.00', basis: 'MONTHLY', effectiveFrom: '2026-08-01', reason: 'Increment' })
      .expect(201);
    await calculate();
    const body = (await list()).body;
    expect(body.checked).toBe(0);
    expect(body.payslips.find((row: { staffId: string }) => row.staffId === staffId)).toMatchObject({ checked: null, changedSinceCheck: true });
    await check(staffId, true).expect(200);
    expect((await list()).body.checked).toBe(1);
  });

  it('"Download all" is one PDF, one page per payslip, marked DRAFT in its name', async () => {
    const res = await request(server()).get(`/workforce/payroll/runs/${runId}/payslip-preview/all.pdf`).set('Authorization', bearer).expect(200);
    expect(res.headers['content-disposition']).toContain('payslips-2026-08-DRAFT.pdf');
    expect(pages(res.body)).toBe(2);
  });

  it('after approval it previews the approved payslips, and a check at the same figures still counts', async () => {
    await request(server()).patch(`/workforce/payroll/runs/${runId}/approve`).set('Authorization', bearer).send({ acknowledgeStatutoryGap: true }).expect(200);
    const body = (await list()).body;
    expect(body).toMatchObject({ draft: false, revision: 1, checked: 1, total: 2 });
    await check(staffId, false).expect(200);
    expect((await list()).body.checked).toBe(0);
    const all = await request(server()).get(`/workforce/payroll/runs/${runId}/payslip-preview/all.pdf`).set('Authorization', bearer).expect(200);
    expect(all.headers['content-disposition']).toContain('payslips-2026-08.pdf');
  });
});
