import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';
import { backfillStaffDefaults } from '../src/workforce/new-staff-defaults';

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

  /* New-clinic UAT #2 re-check, 3 November 2026. */
  const balances = (staffId: string) => request(server()).get(`/workforce/leave/balances/${staffId}?year=2026`).set('Authorization', owner).expect(200);

  it('gives staff on file from before a leave policy and a number, changing nothing already set (item 78)', async () => {
    const older = await add('Demo Older', { startDate: '2026-02-01' });
    const typed = await add('Demo Typed', { employeeNo: 'X-9' });
    // As they were before 1 November 2026: no policy and no number.
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.employeeProfile.updateMany({ where: { staffId: { in: [older.body.staffId, typed.body.staffId] } }, data: { leavePolicyId: null } }),
    );
    await withTenantContext(prisma, tenantId, (tx) => tx.employeeProfile.update({ where: { staffId: older.body.staffId }, data: { employeeNo: null } }));
    const dry = await withTenantContext(prisma, tenantId, (tx) => backfillStaffDefaults(tx, tenantId, false));
    expect(dry).toEqual({ leavePolicyAssigned: 2, employeeNumbersGiven: 1, numbers: [] });
    expect((await record(older.body.staffId)).body.leavePolicy).toBeNull();
    const done = await withTenantContext(prisma, tenantId, (tx) => backfillStaffDefaults(tx, tenantId, true));
    expect(done.leavePolicyAssigned).toBe(2);
    expect(done.numbers).toHaveLength(1);
    expect((await record(older.body.staffId)).body.leavePolicy).toMatchObject({ name: 'Standard leave' });
    expect((await record(older.body.staffId)).body.employment.employeeNo).toBe(done.numbers[0]);
    expect((await record(typed.body.staffId)).body.employment.employeeNo).toBe('X-9');
  });

  it('shows the same annual leave on the record as on the Leave page (item 78)', async () => {
    const joiner = await add('Demo Joiner', { startDate: '2026-10-15' });
    const fromLeave = (await balances(joiner.body.staffId)).body.balances.find((row: { leaveType: string }) => row.leaveType === 'ANNUAL');
    expect(fromLeave.available).toBe(1.5);
    expect((await record(joiner.body.staffId)).body.annualLeave).toEqual({ fullYear: 8, thisYear: 1.5, policyName: 'Standard leave' });
  });

  it('offers maternity leave to women and paternity leave to men (item 79)', async () => {
    const her = await add('Demo Puan', { gender: 'FEMALE' });
    const him = await add('Demo Encik', { gender: 'MALE' });
    const types = async (staffId: string) => (await balances(staffId)).body.balances.map((row: { leaveType: string }) => row.leaveType);
    expect(await types(her.body.staffId)).toEqual(expect.arrayContaining(['MATERNITY']));
    expect(await types(her.body.staffId)).not.toContain('PATERNITY');
    expect(await types(him.body.staffId)).toEqual(expect.arrayContaining(['PATERNITY']));
    expect(await types(him.body.staffId)).not.toContain('MATERNITY');
  });

  it('gives compassionate leave in full and rounds as the clinic chooses (item 80)', async () => {
    const joiner = await add('Demo Late Joiner', { startDate: '2026-10-15' });
    const row = async (type: string) =>
      (await balances(joiner.body.staffId)).body.balances.find((balance: { leaveType: string }) => balance.leaveType === type);
    expect((await row('COMPASSIONATE')).available).toBe(3);
    expect((await row('ANNUAL')).available).toBe(1.5);
    await request(server()).put('/global-settings/hr.leaveEntitlements').set('Authorization', owner).send({ value: { rounding: 'WHOLE', notProRated: ['COMPASSIONATE'] } }).expect(200);
    expect((await row('ANNUAL')).available).toBe(2);
  });
});
