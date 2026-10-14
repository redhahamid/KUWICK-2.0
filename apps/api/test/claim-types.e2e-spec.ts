import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { bearerFor, createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();

/**
 * THE CLINIC'S OWN CLAIM TYPES (Section E, 14 October 2026): mileage priced
 * per km and paid up to the daily cap (decision 9), a receipt rule per type,
 * and a clinic-defined type. Demo people only.
 */
describe('clinic claim types (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let nurseBearer: string;

  const server = () => app.getHttpServer();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'Claim Types Tenant' } }));
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    const clinicId = (await request(server()).post('/clinics').set('Authorization', bearer).send({ name: 'Claims Clinic' }).expect(201)).body.id;
    const nurse = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Demo Nurse Claims', clinicId } }),
    );
    nurseBearer = bearerFor(tenantId, nurse.id, Role.FRONT_DESK_CLINICAL_STAFF);
    await request(server())
      .post(`/workforce/employees/${nurse.id}`)
      .set('Authorization', bearer)
      .send({ employeeNo: 'CL-1', position: 'Nurse', employmentType: 'PERMANENT', employmentStatus: 'ACTIVE', startDate: '2024-01-01', dateOfBirth: '1990-01-01' })
      .expect(201);

    const types = (await request(server()).get('/workforce/claim-types').set('Authorization', bearer).expect(200)).body as { id: string; code: string }[];
    const mileage = types.find((row) => row.code === 'MILEAGE')!;
    await request(server())
      .patch(`/workforce/claim-types/${mileage.id}`)
      .set('Authorization', bearer)
      .send({ name: 'Mileage', unit: 'KM', ratePerUnit: 0.6, dailyUnitCap: 50, receiptRequired: false })
      .expect(200);
    await request(server())
      .post('/workforce/claim-types')
      .set('Authorization', bearer)
      .send({ code: 'PARKING', name: 'Parking', receiptRequired: true })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const claim = (body: Record<string, unknown>) =>
    request(server())
      .post('/me/claims')
      .set('Authorization', nurseBearer)
      .send({ amountClaimed: '1.00', claimDate: '2026-10-05', description: 'Home visit, demo patient', ...body });

  it('pays mileage up to the daily km cap and says what was not paid', async () => {
    const first = await claim({ category: 'MILEAGE', distanceKm: 60 }).expect(201);
    expect(Number(first.body.amountClaimed)).toBe(30);
    expect(first.body.unpaidNote).toBe('10 km over the 50 km daily cap are not paid.');

    const again = await claim({ category: 'MILEAGE', distanceKm: 5 }).expect(400);
    expect(again.body.message).toContain('daily cap of 50 km is already used');
  });

  it('asks for a receipt where the type says so, and lists the clinic types in My Kuwick', async () => {
    const policy = (await request(server()).get('/me/claim-policy').set('Authorization', nurseBearer).expect(200)).body;
    expect(policy.types.map((row: { code: string }) => row.code)).toEqual(expect.arrayContaining(['MILEAGE', 'PARKING']));
    const refused = await claim({ category: 'PARKING', amountClaimed: '8.00' }).expect(400);
    expect(refused.body.message).toMatch(/receipt/i);
    await claim({ category: 'NOT_A_TYPE', amountClaimed: '8.00' }).expect(400);
  });
});
