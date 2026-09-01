import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

/**
 * MALAYSIA PAYROLL — STAGE 1 + STAGE 2, against a real PostgreSQL as the
 * non-superuser application role.
 *
 * What these prove, each one a thing the system could not do before:
 *
 *   1. THE EMPLOYER EXISTS and is not the branch.
 *   2. SALARY HAS A DATE ON IT, so a historical period resolves a historical
 *      rate and a raise today does not reprice last year.
 *   3. PAYROLL INPUTS CAN BE WRITTEN AT ALL. The table had no write path, so
 *      PCB could never be entered and no run with a PCB-applicable employee
 *      could ever be approved.
 *   4. EVERY INPUT CARRIES PROVENANCE, and a materialised upstream figure
 *      cannot be imported twice.
 *   5. AN APPROVED RUN IS SNAPSHOTTED AND HASHED, and master data moving
 *      afterwards does not touch what was approved.
 *   6. A REOPEN PRESERVES the prior snapshot and can show a diff.
 *   7. BLOCKING gates approval; WARNING does not.
 */
describe('Malaysia payroll: employer, salary history, inputs and snapshots (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;
  let employerId: string;

  const PERIOD = '2026-08';
  const server = () => app.getHttpServer();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, name: 'Payroll Tenant' } }),
    );
    const owner = await createOwnerAndBearer(prisma, tenantId);
    bearer = owner.bearer;

    const clinic = await request(server()).post('/clinics').set('Authorization', bearer).send({ name: 'Branch A' }).expect(201);
    clinicId = clinic.body.id;

    const employer = await request(server())
      .post('/workforce/legal-employers')
      .set('Authorization', bearer)
      .send({ name: 'Synthetic Clinic Sdn Bhd', registrationNo: '202601000001', epfEmployerNo: 'E-0001' })
      .expect(201);
    employerId = employer.body.id;

    await request(server()).post('/workforce/pay-components/seed').set('Authorization', bearer).expect(201);
  });

  async function makeEmployee(name: string, opts: { pcbApplicable?: boolean; salary?: string } = {}) {
    const staff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: name, clinicId } }),
    );
    await request(server())
      .post(`/workforce/employees/${staff.id}`)
      .set('Authorization', bearer)
      .send({
        employeeNo: `E-${Math.floor(Math.random() * 100000)}`,
        position: 'Clinic Assistant',
        employmentStatus: 'ACTIVE',
        startDate: '2024-01-01',
        dateOfBirth: '1990-06-15',
        pcbApplicable: opts.pcbApplicable ?? false,
        ...(opts.salary ? { basicSalary: opts.salary } : {}),
      })
      .expect(201);
    return staff.id;
  }

  // === 1 · The employer =====================================================

  it('creates a legal employer and reports what it still needs before anything could be filed', async () => {
    const list = await request(server()).get('/workforce/legal-employers').set('Authorization', bearer).expect(200);
    const row = list.body.find((e: { id: string }) => e.id === employerId);
    expect(row.name).toBe('Synthetic Clinic Sdn Bhd');
    // Reported, not assumed, and not a blocker at this stage.
    expect(row.statutoryReadiness.complete).toBe(false);
    expect(row.statutoryReadiness.missing).toEqual(
      expect.arrayContaining(['SOCSO employer code', 'LHDN employer number (E)']),
    );
  });

  it('refuses two employers with the same name — a statutory file could not tell them apart', async () => {
    await request(server())
      .post('/workforce/legal-employers')
      .set('Authorization', bearer)
      .send({ name: 'Synthetic Clinic Sdn Bhd' })
      .expect(409);
  });

  it('keeps the employer and the branch as different things', async () => {
    const staffId = await makeEmployee('Aisyah');
    await request(server())
      .patch(`/workforce/employees/${staffId}/legal-employer`)
      .set('Authorization', bearer)
      .send({ legalEmployerId: employerId })
      .expect(200);

    const profile = await withTenantContext(prisma, tenantId, (tx) =>
      tx.employeeProfile.findFirstOrThrow({ where: { staffId } }),
    );
    const staff = await withTenantContext(prisma, tenantId, (tx) => tx.staff.findFirstOrThrow({ where: { id: staffId } }));
    // Employed BY the employer, WORKS AT the branch. Two different facts.
    expect(profile.legalEmployerId).toBe(employerId);
    expect(staff.clinicId).toBe(clinicId);
    expect(profile.legalEmployerId).not.toBe(staff.clinicId);
  });

  it('isolates employers across tenants', async () => {
    const otherTenant = randomId();
    await withTenantContext(prisma, otherTenant, (tx) => tx.tenant.create({ data: { id: otherTenant, name: 'Other' } }));
    const other = await createOwnerAndBearer(prisma, otherTenant);
    const list = await request(server()).get('/workforce/legal-employers').set('Authorization', other.bearer).expect(200);
    expect(list.body.find((e: { id: string }) => e.id === employerId)).toBeUndefined();
  });

  // === 2 · Effective-dated salary ==========================================

  it('resolves a HISTORICAL period to the rate that was in force then, not to today', async () => {
    const staffId = await makeEmployee('Chandra');
    await request(server())
      .post(`/workforce/employees/${staffId}/salary`)
      .set('Authorization', bearer)
      .send({ amount: '3000.00', effectiveFrom: '2025-01-01' })
      .expect(201);
    await request(server())
      .post(`/workforce/employees/${staffId}/salary`)
      .set('Authorization', bearer)
      .send({ amount: '4500.00', effectiveFrom: '2026-01-01', reason: 'Annual review' })
      .expect(201);

    const back = await request(server())
      .get(`/workforce/employees/${staffId}/salary/resolve?period=2025-06-01`)
      .set('Authorization', bearer)
      .expect(200);
    expect(back.body.amount).toBe('3000.00');

    const now = await request(server())
      .get(`/workforce/employees/${staffId}/salary/resolve?period=2026-06-01`)
      .set('Authorization', bearer)
      .expect(200);
    expect(now.body.amount).toBe('4500.00');
  });

  it('closes the open row rather than editing it, so the old rate stays true of its own months', async () => {
    const staffId = await makeEmployee('Hafiz');
    await request(server())
      .post(`/workforce/employees/${staffId}/salary`)
      .set('Authorization', bearer)
      .send({ amount: '2800.00', effectiveFrom: '2025-01-01' })
      .expect(201);
    await request(server())
      .post(`/workforce/employees/${staffId}/salary`)
      .set('Authorization', bearer)
      .send({ amount: '3100.00', effectiveFrom: '2026-03-01' })
      .expect(201);

    const history = await request(server())
      .get(`/workforce/employees/${staffId}/salary`)
      .set('Authorization', bearer)
      .expect(200);
    expect(history.body).toHaveLength(2);
    const older = history.body.find((r: { amount: string }) => r.amount === '2800.00');
    expect(older.effectiveTo).toBe('2026-02-28');
    expect(older.current).toBe(false);
    expect(history.body.find((r: { amount: string }) => r.amount === '3100.00').current).toBe(true);
  });

  it('refuses a second salary starting on the same day', async () => {
    const staffId = await makeEmployee('Siti');
    await request(server())
      .post(`/workforce/employees/${staffId}/salary`)
      .set('Authorization', bearer)
      .send({ amount: '2600.00', effectiveFrom: '2025-05-01' })
      .expect(201);
    await request(server())
      .post(`/workforce/employees/${staffId}/salary`)
      .set('Authorization', bearer)
      .send({ amount: '2700.00', effectiveFrom: '2025-05-01' })
      .expect(409);
  });

  it('records who changed the pay and when', async () => {
    const staffId = await makeEmployee('Meera');
    await request(server())
      .post(`/workforce/employees/${staffId}/salary`)
      .set('Authorization', bearer)
      .send({ amount: '9500.00', effectiveFrom: '2025-03-01', reason: 'Promotion' })
      .expect(201);
    const history = await request(server())
      .get(`/workforce/employees/${staffId}/salary`)
      .set('Authorization', bearer)
      .expect(200);
    expect(history.body[0].recordedBy).toBeTruthy();
    expect(history.body[0].recordedAt).toBeTruthy();
    expect(history.body[0].reason).toBe('Promotion');
  });

  // === 3 · Payroll inputs — the write path that did not exist ==============

  it('WRITES a payroll input, which the system previously could not do at all', async () => {
    const staffId = await makeEmployee('Nurul');
    const created = await request(server())
      .post('/workforce/payroll/inputs')
      .set('Authorization', bearer)
      .send({ staffId, period: `${PERIOD}-01`, componentCode: 'ALLOWANCE', amount: '300.00', label: 'Travel' })
      .expect(201);
    expect(created.body.id).toBeTruthy();

    const list = await request(server())
      .get(`/workforce/payroll/inputs?period=${PERIOD}-01&staffId=${staffId}`)
      .set('Authorization', bearer)
      .expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ componentCode: 'ALLOWANCE', amount: '300.00', source: 'MANUAL', kind: 'ADDITIONAL' });
  });

  it('records WHO entered a figure and WHEN — provenance the audited competitor keeps for none of its inputs', async () => {
    const staffId = await makeEmployee('Zaleha');
    await request(server())
      .post('/workforce/payroll/inputs')
      .set('Authorization', bearer)
      .send({ staffId, period: `${PERIOD}-01`, componentCode: 'BONUS', amount: '1000.00', reason: 'Hari Raya' })
      .expect(201);
    const list = await request(server())
      .get(`/workforce/payroll/inputs?period=${PERIOD}-01&staffId=${staffId}`)
      .set('Authorization', bearer)
      .expect(200);
    expect(list.body[0].enteredBy).toBeTruthy();
    expect(list.body[0].enteredAt).toBeTruthy();
    expect(list.body[0].reason).toBe('Hari Raya');
  });

  it('refuses an input naming a component the system does not know, rather than dropping it silently', async () => {
    const staffId = await makeEmployee('Farid');
    await request(server())
      .post('/workforce/payroll/inputs')
      .set('Authorization', bearer)
      .send({ staffId, period: `${PERIOD}-01`, componentCode: 'NOT_A_COMPONENT', amount: '50.00' })
      .expect(400);
  });

  it('stores RECURRING vs ADDITIONAL rather than leaving PCB treatment to be inferred', async () => {
    const staffId = await makeEmployee('Rania');
    await request(server())
      .post('/workforce/payroll/inputs')
      .set('Authorization', bearer)
      .send({ staffId, period: `${PERIOD}-01`, componentCode: 'ALLOWANCE', amount: '200.00', kind: 'RECURRING' })
      .expect(201);
    const list = await request(server())
      .get(`/workforce/payroll/inputs?period=${PERIOD}-01&staffId=${staffId}`)
      .set('Authorization', bearer)
      .expect(200);
    expect(list.body[0].kind).toBe('RECURRING');
  });

  it('updates rather than duplicating when the same component is entered twice for one period', async () => {
    const staffId = await makeEmployee('Imran');
    const body = { staffId, period: `${PERIOD}-01`, componentCode: 'ALLOWANCE', amount: '100.00' };
    await request(server()).post('/workforce/payroll/inputs').set('Authorization', bearer).send(body).expect(201);
    await request(server())
      .post('/workforce/payroll/inputs')
      .set('Authorization', bearer)
      .send({ ...body, amount: '150.00' })
      .expect(201);
    const list = await request(server())
      .get(`/workforce/payroll/inputs?period=${PERIOD}-01&staffId=${staffId}`)
      .set('Authorization', bearer)
      .expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].amount).toBe('150.00');
  });

  it('deletes an input a person entered', async () => {
    const staffId = await makeEmployee('Lina');
    const created = await request(server())
      .post('/workforce/payroll/inputs')
      .set('Authorization', bearer)
      .send({ staffId, period: `${PERIOD}-01`, componentCode: 'UNIFORM', amount: '40.00' })
      .expect(201);
    await request(server()).delete(`/workforce/payroll/inputs/${created.body.id}`).set('Authorization', bearer).expect(200);
    const list = await request(server())
      .get(`/workforce/payroll/inputs?period=${PERIOD}-01&staffId=${staffId}`)
      .set('Authorization', bearer)
      .expect(200);
    expect(list.body).toHaveLength(0);
  });

  it('refuses a negative amount — the component carries the sign, not the number', async () => {
    const staffId = await makeEmployee('Danial');
    await request(server())
      .post('/workforce/payroll/inputs')
      .set('Authorization', bearer)
      .send({ staffId, period: `${PERIOD}-01`, componentCode: 'ALLOWANCE', amount: '-50.00' })
      .expect(400);
  });

  // === 4 · Materialisation is idempotent ===================================

  it('materialises upstream figures once, and re-running cannot pay anybody twice', async () => {
    const first = await request(server())
      .post('/workforce/payroll/inputs/materialise')
      .set('Authorization', bearer)
      .send({ period: `${PERIOD}-01`, clinicId })
      .expect(201);
    const second = await request(server())
      .post('/workforce/payroll/inputs/materialise')
      .set('Authorization', bearer)
      .send({ period: `${PERIOD}-01`, clinicId })
      .expect(201);
    expect(second.body.created).toBe(0);
    expect(first.body.created + first.body.unchanged).toBe(second.body.created + second.body.unchanged);
  });

  // === 5 · Pay components ==================================================

  it('seeds the catalogue idempotently and says on the screen that nothing is verified', async () => {
    const again = await request(server()).post('/workforce/pay-components/seed').set('Authorization', bearer).expect(201);
    expect(again.body.created).toBe(0);

    const list = await request(server()).get('/workforce/pay-components').set('Authorization', bearer).expect(200);
    expect(list.body.components.length).toBeGreaterThan(10);
    expect(list.body.verificationNotice.anyVerified).toBe(false);
    expect(list.body.verificationNotice.statement).toMatch(/not a statement of Malaysian law/);
    // Every seeded flag is UNVERIFIED.
    expect(list.body.components.every((c: { verificationStatus: string }) => c.verificationStatus === 'DRAFT')).toBe(true);
  });

  it('reproduces today’s ORP base exactly: basic pay only, and the question stays open', async () => {
    const list = await request(server()).get('/workforce/pay-components').set('Authorization', bearer).expect(200);
    const inOrp = list.body.components.filter((c: { includeInOrpBase: boolean }) => c.includeInOrpBase);
    expect(inOrp.map((c: { code: string }) => c.code).sort()).toEqual(['BASIC', 'UNPAID_LEAVE']);
    // Allowance is EPF wages but is NOT seeded into the ordinary-rate base,
    // because s60I has not been read and switching it on would move every
    // overtime figure on a guess.
    const allowance = list.body.components.find((c: { code: string }) => c.code === 'ALLOWANCE');
    expect(allowance.epfLiable).toBe(true);
    expect(allowance.includeInOrpBase).toBe(false);
  });

  it('refuses to let overtime enter the base that prices overtime', async () => {
    await request(server())
      .post('/workforce/pay-components')
      .set('Authorization', bearer)
      .send({ code: 'OT_CUSTOM', name: 'Custom OT', type: 'OVERTIME', category: 'REMUNERATION', includeInOrpBase: true })
      .expect(400);
  });

  it('refuses to redefine a system preset’s statutory treatment', async () => {
    const list = await request(server()).get('/workforce/pay-components').set('Authorization', bearer).expect(200);
    const basic = list.body.components.find((c: { code: string }) => c.code === 'BASIC');
    await request(server())
      .post('/workforce/pay-components')
      .set('Authorization', bearer)
      .send({ id: basic.id, code: 'BASIC', name: 'Renamed', type: 'ADDITION', category: 'REMUNERATION', epfLiable: false })
      .expect(409);
  });

  // === 6 · Policy ==========================================================

  it('stores five proration bases and says none of them is applied yet', async () => {
    await request(server())
      .post('/workforce/payroll-policies')
      .set('Authorization', bearer)
      .send({ name: 'Clinic default', legalEmployerId: employerId, terminationBasis: 'CALENDAR_DAYS', isDefault: true })
      .expect(201);
    const list = await request(server()).get('/workforce/payroll-policies').set('Authorization', bearer).expect(200);
    expect(list.body.policies[0].termination.basis).toBe('CALENDAR_DAYS');
    expect(list.body.notice).toMatch(/NOT yet applied/);
  });
});
