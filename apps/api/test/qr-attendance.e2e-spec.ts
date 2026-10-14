import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { bearerFor, createOwnerAndBearer } from './auth';
import { kioskCode } from '../src/workforce/attendance-qr';

/**
 * QR ATTENDANCE (UAT, 14 October 2026): scan the kiosk code with your own
 * phone; an old code fails; away from the clinic is refused when the clinic
 * says so; a PIN at the kiosk works and is marked PIN. Demo people only.
 */
describe('QR attendance (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let owner: string;
  let clinicId: string;
  let nurseId: string;
  let nurse: string;

  const server = () => app.getHttpServer();
  const scan = (body: Record<string, unknown>, auth = nurse, ip = '10.9.9.9') =>
    request(server()).post('/me/attendance/clock').set('Authorization', auth).set('X-Forwarded-For', ip).send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();
    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'Klinik Imbas (Synthetic)' } }));
    owner = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    clinicId = (await request(server()).post('/clinics').set('Authorization', owner).send({ name: 'Klinik Imbas' }).expect(201)).body.id;
    nurseId = (
      await withTenantContext(prisma, tenantId, (tx) =>
        tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Demo Jururawat Imbas', clinicId, active: true } }),
      )
    ).id;
    nurse = bearerFor(tenantId, nurseId, Role.FRONT_DESK_CLINICAL_STAFF);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('clocks in with the code on the kiosk, and refuses an old one', async () => {
    const kiosk = (await request(server()).get(`/workforce/attendance/kiosk?clinicId=${clinicId}`).set('Authorization', owner).expect(200)).body;
    expect(kiosk.periodSeconds).toBe(30);
    const old = kioskCode(clinicId, new Date(Date.now() - 5 * 60_000), 30).code;
    expect((await scan({ qr: old }).expect(400)).body.message).toMatch(/expired/);
    const done = (await scan({ qr: kiosk.code }).expect(201)).body;
    expect(done).toMatchObject({ source: 'QR', clinicId });
    // The same scan again a moment later is not a clock-out.
    expect((await scan({ qr: kiosk.code }).expect(400)).body.message).toMatch(/moment ago/);
  });

  it('refuses a clock-in away from the clinic when the clinic says so; its WiFi passes', async () => {
    await request(server())
      .post('/workforce/attendance/policy')
      .set('Authorization', owner)
      .send({ clinicId, locationMode: 'REFUSE', clinicNetworks: '203.106.12.' })
      .expect(201);
    const second = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Demo Staf Rumah', clinicId, active: true } }),
    );
    const away = bearerFor(tenantId, second.id, Role.FRONT_DESK_CLINICAL_STAFF);
    const code = (await request(server()).get(`/workforce/attendance/kiosk?clinicId=${clinicId}`).set('Authorization', owner).expect(200)).body.code;
    expect((await scan({ qr: code }, away, '10.0.0.1').expect(403)).body.message).toMatch(/not at the clinic/);
    await scan({ qr: code }, away, '203.106.12.77').expect(201);
  });

  it('a PIN at the kiosk works for its owner, is marked PIN, and a wrong one is refused', async () => {
    const third = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Demo Staf PIN', clinicId, active: true } }),
    );
    const own = bearerFor(tenantId, third.id, Role.FRONT_DESK_CLINICAL_STAFF);
    await request(server()).put('/me/attendance-pin').set('Authorization', own).send({ pin: '12' }).expect(400);
    await request(server()).put('/me/attendance-pin').set('Authorization', own).send({ pin: '4826' }).expect(200);
    const kiosk = (await request(server()).get(`/workforce/attendance/kiosk?clinicId=${clinicId}`).set('Authorization', owner).expect(200)).body;
    expect(kiosk.pinPeople.map((row: { name: string }) => row.name)).toEqual(['Demo Staf PIN']);
    await request(server()).post('/workforce/attendance/kiosk/pin').set('Authorization', owner).send({ clinicId, staffId: third.id, pin: '0000' }).expect(400);
    const done = (
      await request(server()).post('/workforce/attendance/kiosk/pin').set('Authorization', owner).set('X-Forwarded-For', '203.106.12.5').send({ clinicId, staffId: third.id, pin: '4826' }).expect(201)
    ).body;
    expect(done).toMatchObject({ source: 'PIN', staffId: third.id });
  });
});
