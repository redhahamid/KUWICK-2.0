import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { bearerFor, createOwnerAndBearer } from './auth';

/**
 * A MONTH STARTED TOO EARLY CAN BE THROWN AWAY.
 *
 * A clinic pressed Start before its people had a rest day or a standing, got
 * a draft with RM0.00 in every column and everybody left out, and then had
 * nowhere to go: no discard, and the recalculation dying on a five-second
 * transaction budget with "Internal server error". A dead January, for good.
 *
 * Two things are proven here. An unapproved run can be discarded and the
 * month started again; an approved one cannot, by anybody, because money
 * moved on it.
 */
jest.setTimeout(120_000);

describe('discarding an unapproved payroll run (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let owner: string;
  let ownerStaffId: string;
  let clinicId: string;

  const PERIOD = '2026-01';
  const server = () => app.getHttpServer();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'Discard Tenant' } }));
    const account = await createOwnerAndBearer(prisma, tenantId);
    owner = account.bearer;
    ownerStaffId = account.staffId;

    const clinic = await request(server()).post('/clinics').set('Authorization', owner).send({ name: 'KLINIK HIJRAA BANGI' }).expect(201);
    clinicId = clinic.body.id;
    const employer = await request(server())
      .post('/workforce/legal-employers')
      .set('Authorization', owner)
      .send({ name: 'Hijraa Bangi Sdn Bhd', epfEmployerNo: 'EPF-D-1' })
      .expect(201);
    await request(server()).post('/workforce/pay-components/seed').set('Authorization', owner).expect(201);

    // One person, ready to be paid, so a run has a line to lose.
    const created = await request(server())
      .post('/workforce/employees')
      .set('Authorization', owner)
      .send({
        fullName: 'Discard Amirah',
        role: Role.FRONT_DESK_CLINICAL_STAFF,
        clinicId,
        position: 'Clinic Assistant',
        employmentType: 'PERMANENT',
        startDate: '2026-01-01',
        dateOfBirth: '1994-03-08',
        bankName: 'Maybank',
        bankAccountNo: '512345678901',
      })
      .expect(201);
    const staffId = created.body.staff.id as string;
    await request(server())
      .post(`/workforce/employees/${staffId}/statutory-classification`)
      .set('Authorization', owner)
      .send({ effectiveFrom: '2026-01-01', epfMembership: 'MALAYSIAN_CITIZEN', lindungParticipation: 'NOT_PARTICIPATING', restDayOfWeek: 0, taxResidence: 'RESIDENT', pcbCategory: 'CATEGORY_1', reason: 'At hire' })
      .expect(201);
    await request(server()).patch(`/workforce/employees/${staffId}/legal-employer`).set('Authorization', owner).send({ legalEmployerId: employer.body.id }).expect(200);
    await request(server())
      .post(`/workforce/employees/${staffId}/salary`)
      .set('Authorization', owner)
      .send({ amount: '2800.00', basis: 'MONTHLY', effectiveFrom: '2026-01-01', reason: 'Starting salary' })
      .expect(201);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  const start = async () =>
    (await request(server()).post('/workforce/payroll/runs').set('Authorization', owner).send({ period: PERIOD, clinicId }).expect(201)).body.id as string;

  it('discards a draft, and the month can be started again', async () => {
    const first = await start();
    // A second regular run for the month is refused while the first is live.
    await request(server()).post('/workforce/payroll/runs').set('Authorization', owner).send({ period: PERIOD, clinicId }).expect(409);

    const discarded = await request(server()).delete(`/workforce/payroll/runs/${first}`).set('Authorization', owner).send({ reason: 'Started before the setup was done' }).expect(200);
    expect(discarded.body).toMatchObject({ discarded: true, period: PERIOD, clinicId });
    await request(server()).get(`/workforce/payroll/runs/${first}`).set('Authorization', owner).expect(404);

    // The home for the month is back to "not started".
    const home = await request(server()).get(`/workforce/payroll/home?period=${PERIOD}&clinicId=${clinicId}`).set('Authorization', owner).expect(200);
    expect(home.body.run).toBeNull();

    // And Start works again — the sequence moves on, the constraint does not bite.
    const second = await start();
    expect(second).not.toBe(first);

    const audit = await withTenantContext(prisma, tenantId, (tx) =>
      tx.auditLog.findFirst({ where: { entityType: 'PayrollRun', entityId: first } }),
    );
    expect(audit?.action).toBe('payroll.discarded');
    expect((audit?.before as { period: string }).period).toBe(PERIOD);
  });

  it('discards a calculated run too — nothing was paid from it', async () => {
    const home = await request(server()).get(`/workforce/payroll/home?period=${PERIOD}&clinicId=${clinicId}`).set('Authorization', owner).expect(200);
    const runId = home.body.run.id as string;
    await request(server()).patch(`/workforce/payroll/runs/${runId}/calculate`).set('Authorization', owner).expect(200);
    const before = await request(server()).get(`/workforce/payroll/runs/${runId}`).set('Authorization', owner).expect(200);
    expect(before.body.status).toBe('CALCULATED');
    expect(before.body.employeeCount).toBe(1);

    await request(server()).delete(`/workforce/payroll/runs/${runId}`).set('Authorization', owner).expect(200);
    // Its lines went with it.
    const lines = await withTenantContext(prisma, tenantId, (tx) => tx.payrollLine.count({ where: { payrollRunId: runId } }));
    expect(lines).toBe(0);
  });

  /*
   * APPROVED IS SETTLED. The refusal is the same one every other write meets,
   * and it is not a permission: the owner is refused too.
   */
  it('refuses to discard an approved run, and a paid one', async () => {
    const runId = await start();
    await request(server()).patch(`/workforce/payroll/runs/${runId}/calculate`).set('Authorization', owner).expect(200);
    await request(server()).patch(`/workforce/payroll/runs/${runId}/approve`).set('Authorization', owner).expect(200);

    const refused = await request(server()).delete(`/workforce/payroll/runs/${runId}`).set('Authorization', owner).expect(409);
    expect(String(refused.body.message)).toContain('approved');
    await request(server()).get(`/workforce/payroll/runs/${runId}`).set('Authorization', owner).expect(200);

    await withTenantContext(prisma, tenantId, (tx) => tx.payrollRun.update({ where: { id: runId }, data: { status: 'PAID' } }));
    const paid = await request(server()).delete(`/workforce/payroll/runs/${runId}`).set('Authorization', owner).expect(409);
    expect(String(paid.body.message)).toContain('paid');
  });

  /*
   * THE BRANCH HAS TO BE ONE THE ACCOUNT MANAGES — the rule that governs
   * starting a run governs throwing one away.
   */
  it('refuses a manager scoped to another branch', async () => {
    const other = await request(server()).post('/clinics').set('Authorization', owner).send({ name: 'Elsewhere' }).expect(201);
    const manager = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.CLINIC_MANAGER, fullName: 'Other Branch Manager', clinicId: other.body.id } }),
    );
    // A fresh draft at OUR branch, to be refused from THEIRS.
    const runId = (
      await request(server()).post('/workforce/payroll/runs').set('Authorization', owner).send({ period: '2026-02', clinicId }).expect(201)
    ).body.id as string;
    const res = await request(server()).delete(`/workforce/payroll/runs/${runId}`).set('Authorization', bearerFor(tenantId, manager.id));
    expect([403, 404]).toContain(res.status);
    await request(server()).get(`/workforce/payroll/runs/${runId}`).set('Authorization', owner).expect(200);
    expect(ownerStaffId).toBeTruthy();
  });
});
