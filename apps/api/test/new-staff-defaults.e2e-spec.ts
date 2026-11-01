import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

/*
 * WHAT A NEW EMPLOYEE STARTS WITH (new-clinic UAT #2, 1 November 2026):
 * the clinic's leave policy, made from its leave types when it has none
 * (item 73), and the next employee number (item 70). Plus two small reads:
 * a record made without a login says so (item 71), and the owner's own
 * account, with no HR record, has no leave (item 53). Demo names only.
 */
describe('new staff defaults (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let owner: string;
  let clinicId: string;
  const server = () => app.getHttpServer();
  const add = (fullName: string, extra: Record<string, unknown> = {}) =>
    request(server())
      .post('/workforce/employees')
      .set('Authorization', owner)
      .send({ fullName, role: Role.FRONT_DESK_CLINICAL_STAFF, clinicId, employmentType: 'PERMANENT', startDate: '2026-10-15', ...extra })
      .expect(201);
  const record = (staffId: string) => request(server()).get(`/workforce/employees/${staffId}/record`).set('Authorization', owner).expect(200);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();
    tenantId = crypto.randomUUID();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'New Staff Defaults Tenant' } }));
    owner = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    clinicId = (await request(server()).post('/clinics').set('Authorization', owner).send({ name: 'Demo Branch' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('numbers new staff E001, E002… and keeps a number typed by hand', async () => {
    expect((await request(server()).get('/workforce/employees/next-number').set('Authorization', owner).expect(200)).body).toEqual({ employeeNo: 'E001' });
    const first = await add('Demo Nurse');
    const second = await add('Demo Clerk');
    const typed = await add('Demo Pharmacist', { employeeNo: 'P-77' });
    expect((await record(first.body.staffId)).body.employment.employeeNo).toBe('E001');
    expect((await record(second.body.staffId)).body.employment.employeeNo).toBe('E002');
    expect((await record(typed.body.staffId)).body.employment.employeeNo).toBe('P-77');
    expect((await request(server()).get('/workforce/employees/next-number').set('Authorization', owner).expect(200)).body).toEqual({ employeeNo: 'E003' });
  });

  it('uses the clinic’s own prefix', async () => {
    await request(server())
      .put('/global-settings/hr.newStaffDefaults')
      .set('Authorization', owner)
      .send({ value: { workDaysPerWeek: 6, probationMonths: 3, departments: ['Clinical'], employeeNoPrefix: 'KDB' } })
      .expect(200);
    expect((await request(server()).get('/workforce/employees/next-number').set('Authorization', owner).expect(200)).body).toEqual({ employeeNo: 'KDB001' });
  });

  it('puts new staff on a Standard leave policy with the Act’s 8 days, pro-rated, paying unused leave out', async () => {
    const policies = await request(server()).get('/workforce/leave/policies').set('Authorization', owner).expect(200);
    expect(policies.body).toHaveLength(1);
    expect(policies.body[0]).toMatchObject({ name: 'Standard leave', proRateOnJoin: true, payUntakenLeaveOnExit: true });
    expect(policies.body[0].entitlements).toEqual(expect.arrayContaining([expect.objectContaining({ leaveType: 'ANNUAL', daysPerYear: 8 })]));
    const nurse = await add('Demo Assistant');
    const body = (await record(nurse.body.staffId)).body;
    expect(body.leavePolicy).toMatchObject({ name: 'Standard leave', annualLeaveDays: 8 });
    // Every new employee goes on the same one; it is made once.
    expect((await request(server()).get('/workforce/leave/policies').set('Authorization', owner).expect(200)).body).toHaveLength(1);
  });

  it('says "no login" when none was given', async () => {
    const person = await add('Demo Cleaner');
    expect((await record(person.body.staffId)).body.identity).toMatchObject({ hasLogin: false });
  });

  it('gives the owner’s own account, with no HR record, no leave', async () => {
    const mine = await request(server()).get('/me/leave/balances').set('Authorization', owner).expect(200);
    expect(mine.body.balances).toEqual([]);
    expect(mine.body.hasHrRecord).toBe(false);
  });
});
