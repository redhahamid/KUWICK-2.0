import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { bearerFor, createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();

/**
 * THE PAYSLIP COMES FROM THE APPROVED SNAPSHOT AND NOWHERE ELSE.
 *
 * The headline proof: approve a run, reopen it, move the salary and
 * recalculate — the run's own lines now carry candidate figures — and the
 * payslip STILL shows exactly what was approved, because it is composed from
 * the frozen snapshot. A slip drawn from the lines at that moment would show
 * unapproved money under an approved letterhead, which is the defect this
 * service exists to prevent.
 */
/**
 * REOPENING AN APPROVED MONTH (UAT, 14 October 2026): "KLINIK HIJRAA BANGI
 * June 2026 was approved, then we found two doctors should be opted out of
 * LINDUNG 24 JAM from 1 Jun 2026." Owner or payroll approver only, with a
 * reason, logged; refused while a later month is approved or a transfer or
 * statutory filing is recorded; approved again it is revision 2, and
 * revision 1 stays viewable. Demo people only.
 */
describe('reopening an approved month (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;
  let legalEmployerId: string;
  let staffId: string;
  let ownerStaffId: string;
  const runs: Record<string, string> = {};

  const server = () => app.getHttpServer();
  const reopen = (period: string, body: Record<string, unknown>, auth = bearer) =>
    request(server()).patch(`/workforce/payroll/runs/${runs[period]}/reopen`).set('Authorization', auth).send(body);
  const approve = (period: string) =>
    request(server()).patch(`/workforce/payroll/runs/${runs[period]}/approve`).set('Authorization', bearer).send({ acknowledgeStatutoryGap: true }).expect(200);
  const calculate = (period: string) =>
    request(server()).patch(`/workforce/payroll/runs/${runs[period]}/calculate`).set('Authorization', bearer).expect(200);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, name: 'Reopen Tenant' } }),
    );
    const owner = await createOwnerAndBearer(prisma, tenantId);
    bearer = owner.bearer;
    ownerStaffId = owner.staffId;

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

    for (const period of ['2026-06', '2026-07']) {
      runs[period] = (await request(server()).post('/workforce/payroll/runs').set('Authorization', bearer).send({ period, clinicId }).expect(201)).body.id;
      await calculate(period);
      await approve(period);
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('is for the owner or a payroll approver, with a reason', async () => {
    const clerk = bearerFor(tenantId, staffId, Role.FRONT_DESK_CLINICAL_STAFF);
    await reopen('2026-07', { reason: 'Opt two doctors out of LINDUNG' }, clerk).expect(403);
    expect((await reopen('2026-07', { reason: '' }).expect(400)).body.message).toMatch(/Say why/);
  });

  it('refuses while a later month is approved, naming it', async () => {
    const refused = await reopen('2026-06', { reason: 'Opt two doctors out of LINDUNG from 1 Jun 2026' }).expect(409);
    expect(refused.body.message).toMatch(/^June 2026 cannot be reopened\. July 2026 is already approved/);
  });

  it('refuses while a statutory filing is recorded for the month', async () => {
    await reopen('2026-07', { reason: 'Reopen July first, latest first' }).expect(200);
    const filing = await withTenantContext(prisma, tenantId, async (tx) => {
      const snapshot = await tx.payrollSnapshot.findFirstOrThrow({ where: { payrollRunId: runs['2026-06'] }, orderBy: { version: 'desc' } });
      const owner = await tx.staff.findFirstOrThrow({ where: { role: Role.OWNER_ADMIN } });
      return tx.payrollStatutorySubmission.create({
        data: {
          tenantId,
          payrollRunId: runs['2026-06'],
          scheme: 'EPF',
          snapshotVersion: snapshot.version,
          snapshotHash: snapshot.hash,
          submittedDate: new Date('2026-07-10T00:00:00.000Z'),
          reference: 'KWSP-DEMO-1',
          recordedByStaffId: owner.id,
        },
      });
    });
    const refused = await reopen('2026-06', { reason: 'Opt two doctors out of LINDUNG from 1 Jun 2026' }).expect(409);
    expect(refused.body.message).toMatch(/statutory filing is recorded for this month \(EPF submitted 2026-07-10, ref KWSP-DEMO-1\)/);
    await withTenantContext(prisma, tenantId, (tx) => tx.payrollStatutorySubmission.delete({ where: { id: filing.id } }));
  });

  it('goes back to draft, logged, and approved again is revision 2 with revision 1 still there', async () => {
    const done = await reopen('2026-06', { reason: 'Opt two doctors out of LINDUNG from 1 Jun 2026' }).expect(200);
    expect(done.body.run.status).toBe('CALCULATED');
    const audit = await withTenantContext(prisma, tenantId, (tx) =>
      tx.auditLog.findMany({ where: { action: 'payroll.reopened', entityId: runs['2026-06'] } }),
    );
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0].after)).toMatch(/Opt two doctors out of LINDUNG/);

    await calculate('2026-06');
    await approve('2026-06');
    const latest = (await request(server()).get(`/workforce/payroll/runs/${runs['2026-06']}/payslips/${staffId}`).set('Authorization', bearer).expect(200)).body;
    expect(latest.revision).toMatchObject({ version: 2, of: 2, superseded: false });
    const first = (await request(server()).get(`/workforce/payroll/runs/${runs['2026-06']}/payslips/${staffId}?version=1`).set('Authorization', bearer).expect(200)).body;
    expect(first.revision).toMatchObject({ version: 1, of: 2, superseded: true });
  });
});
