import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { bearerFor, createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();

/**
 * THE CLINIC'S OWN LEAVE TYPES (Section D, 14 October 2026). Defaults with the
 * Act's floors, a clinic-defined unpaid type that reaches payroll, a document
 * rule, and opening balances imported by Employee No. Demo people only.
 */
describe('clinic leave types (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let nurseId: string;
  let nurseBearer: string;

  const server = () => app.getHttpServer();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'Leave Types Tenant' } }));
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    const clinicId = (await request(server()).post('/clinics').set('Authorization', bearer).send({ name: 'Leave Clinic' }).expect(201)).body.id;
    const nurse = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Demo Nurse Leave', clinicId } }),
    );
    nurseId = nurse.id;
    nurseBearer = bearerFor(tenantId, nurseId, Role.FRONT_DESK_CLINICAL_STAFF);
    // Joined six years ago: the Act's floor for annual leave is 16 days.
    await request(server())
      .post(`/workforce/employees/${nurseId}`)
      .set('Authorization', bearer)
      .send({ employeeNo: 'LV-1', position: 'Nurse', employmentType: 'PERMANENT', employmentStatus: 'ACTIVE', startDate: '2020-01-01', dateOfBirth: '1990-01-01' })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('starts every clinic on the default types, and refuses a statutory type below the Act', async () => {
    const types = (await request(server()).get('/workforce/leave-types').set('Authorization', bearer).expect(200)).body as {
      id: string;
      code: string;
      actMinimum: number | null;
    }[];
    expect(types.map((row) => row.code)).toEqual(expect.arrayContaining(['ANNUAL', 'MEDICAL', 'MATERNITY', 'PATERNITY', 'UNPAID']));
    const annual = types.find((row) => row.code === 'ANNUAL')!;
    expect(annual.actMinimum).toBe(8);
    await request(server()).patch(`/workforce/leave-types/${annual.id}`).set('Authorization', bearer).send({ name: 'Annual leave', daysPerYear: 6 }).expect(400);
    await request(server())
      .patch(`/workforce/leave-types/${annual.id}`)
      .set('Authorization', bearer)
      .send({ name: 'Annual leave', daysPerYear: 10, carryForwardCap: 5 })
      .expect(200);
  });

  it("gives a long-serving person the Act's floor, and takes opening balances off it", async () => {
    const result = (
      await request(server())
        .post('/workforce/leave/balances/import')
        .set('Authorization', bearer)
        .send({ year: 2026, rows: [{ employeeNo: 'LV-1', leaveType: 'ANNUAL', takenDays: 4, carriedInDays: 2 }] })
        .expect(201)
    ).body;
    expect(result).toEqual({ imported: 1, problems: [] });
    const balances = (await request(server()).get(`/workforce/leave/balances/${nurseId}?year=2026`).set('Authorization', bearer).expect(200)).body;
    const annual = balances.balances.find((row: { leaveType: string }) => row.leaveType === 'ANNUAL');
    // 16 days (six years' service) + 2 carried in − 4 taken before Kuwick.
    expect(annual.entitled).toBe(16);
    expect(annual.remaining).toBe(14);

    const refused = (
      await request(server())
        .post('/workforce/leave/balances/import')
        .set('Authorization', bearer)
        .send({ year: 2026, rows: [{ employeeNo: 'NOBODY', leaveType: 'ANNUAL', takenDays: 1 }, { employeeNo: 'LV-1', leaveType: 'ANNUAL', takenDays: 1, carriedInDays: 9 }] })
        .expect(201)
    ).body;
    expect(refused.imported).toBe(0);
    expect(refused.problems.map((row: { line: number }) => row.line)).toEqual([2, 3]);
  });

  it('lets a person ask for a clinic-defined type in My Kuwick, and asks for its document', async () => {
    await request(server())
      .post('/workforce/leave-types')
      .set('Authorization', bearer)
      .send({ code: 'STUDY', name: 'Study leave', paid: false, daysPerYear: 5, documentRequired: true })
      .expect(201);
    const mine = (await request(server()).get('/me/leave/balances').set('Authorization', nurseBearer).expect(200)).body;
    expect(mine.types.map((row: { code: string }) => row.code)).toContain('STUDY');
    const refused = await request(server())
      .post('/me/leave')
      .set('Authorization', nurseBearer)
      .send({ leaveType: 'STUDY', startDate: '2026-11-02', endDate: '2026-11-02', reason: 'Exam day' })
      .expect(400);
    expect(refused.body.message).toContain('Study leave needs a supporting document');
    await request(server())
      .post('/me/leave')
      .set('Authorization', nurseBearer)
      .send({ leaveType: 'NOT_A_TYPE', startDate: '2026-11-02', endDate: '2026-11-02', reason: 'Exam day' })
      .expect(400);
  });
});
