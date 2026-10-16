import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { bearerFor, createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();

/*
 * WHO MAY CHANGE CLINIC SETTINGS (owner's decision, 16 October 2026): only
 * owner, admin and HR roles. A normal staff login is refused and nothing is
 * written; every change that is allowed leaves an audit row.
 */
describe('clinic settings saved by key (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let owner: string;
  let staff: string;
  let hr: string;
  const server = () => app.getHttpServer();
  const put = (key: string, as: string, value: unknown) => request(server()).put(`/global-settings/${key}`).set('Authorization', as).send({ value });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'Settings Permission Tenant' } }));
    owner = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    const [desk, clerk] = await withTenantContext(prisma, tenantId, (tx) =>
      Promise.all([
        tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Demo Front Desk' } }),
        tx.staff.create({ data: { tenantId, role: Role.HR_STAFF, fullName: 'Demo HR Clerk' } }),
      ]),
    );
    staff = bearerFor(tenantId, desk.id, Role.FRONT_DESK_CLINICAL_STAFF);
    hr = bearerFor(tenantId, clerk.id, Role.HR_STAFF);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('refuses a normal staff login and writes nothing', async () => {
    await put('hr.newStaffDefaults', staff, { workDaysPerWeek: 5, probationMonths: 0, departments: ['Clinical'] }).expect(403);
    await put('hr.setup.openingBalances', staff, { answer: 'NONE', year: 2026 }).expect(403);
    await put('queue.runningText', staff, 'Hello').expect(403);
    const saved = await withTenantContext(prisma, tenantId, (tx) => tx.globalSetting.count({ where: { tenantId } }));
    expect(saved).toBe(0);
  });

  it('lets HR change new-staff defaults, but not payroll setup or other clinic settings', async () => {
    await put('hr.newStaffDefaults', hr, { workDaysPerWeek: 5.5, probationMonths: 3, departments: ['Clinical', 'Admin'] }).expect(200);
    await put('hr.setup.openingBalances', hr, { answer: 'NONE', year: 2026 }).expect(403);
    await put('queue.runningText', hr, 'Hello').expect(403);
    const read = await request(server()).get('/global-settings/hr.newStaffDefaults').set('Authorization', staff).expect(200);
    expect(read.body).toMatchObject({ workDaysPerWeek: 5.5 });
  });

  it('lets the owner change any of them, and records who did', async () => {
    await put('hr.setup.openingBalances', owner, { answer: 'NONE', year: 2026 }).expect(200);
    await put('queue.runningText', owner, 'Selamat datang').expect(200);
    const audits = await withTenantContext(prisma, tenantId, (tx) =>
      tx.auditLog.count({ where: { tenantId, action: 'globalSetting.changed' } }),
    );
    expect(audits).toBe(3);
  });

  it('keeps the value that was sent, and refuses a save with no value', async () => {
    const read = await request(server()).get('/global-settings/hr.setup.openingBalances').set('Authorization', owner).expect(200);
    expect(read.body).toEqual({ answer: 'NONE', year: 2026 });
    await request(server()).put('/global-settings/queue.runningText').set('Authorization', owner).send({}).expect(400);
  });
});
