import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { bearerFor, createOwnerAndBearer } from './auth';

/**
 * ROSTER A3 (UAT, 14 October 2026): a month is a draft until published, and
 * only then shows in My Kuwick; external locums go on by name; and the staff
 * roster and the doctor roster can be given to different people. Demo people
 * only.
 */
describe('roster publishing, locums and split permissions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let owner: string;
  let ownerStaffId: string;
  let clinicId: string;
  let doctorId: string;
  let staffId: string;
  let headNurse: string;

  const server = () => app.getHttpServer();
  const board = async () =>
    (await request(server()).get(`/provider-shifts/month?clinicId=${clinicId}&month=2026-12`).set('Authorization', owner).expect(200)).body;
  const addShift = (who: string, auth: string, date = '2026-12-07') =>
    request(server()).post('/provider-shifts').set('Authorization', auth).send({ clinicId, staffId: who, dates: [date], startTime: '08:00', endTime: '15:00' });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();
    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'Klinik Terbit (Synthetic)' } }));
    const made = await createOwnerAndBearer(prisma, tenantId);
    owner = made.bearer;
    ownerStaffId = made.staffId;
    clinicId = (await request(server()).post('/clinics').set('Authorization', owner).send({ name: 'Klinik Terbit' }).expect(201)).body.id;
    const make = (role: Role, fullName: string) =>
      withTenantContext(prisma, tenantId, (tx) => tx.staff.create({ data: { tenantId, role, fullName, clinicId, active: true } }));
    doctorId = (await make(Role.DOCTOR_RESIDENT, 'Dr Demo Terbit')).id;
    staffId = (await make(Role.FRONT_DESK_CLINICAL_STAFF, 'Demo Staf Terbit')).id;
    const nurse = await make(Role.FRONT_DESK_CLINICAL_STAFF, 'Demo Ketua Jururawat');
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.staffPermissionGrant.create({
        data: { tenantId, staffId: nurse.id, permission: 'roster.manage_staff', grantedByStaffId: ownerStaffId, reason: 'Writes the staff roster' },
      }),
    );
    headNurse = bearerFor(tenantId, nurse.id, Role.FRONT_DESK_CLINICAL_STAFF);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('the staff roster permission writes staff shifts and templates, not doctors or locums', async () => {
    await addShift(staffId, headNurse).expect(201);
    expect((await addShift(doctorId, headNurse).expect(403)).body.message).toMatch(/doctor roster/);
    await request(server())
      .post('/workforce/shift-templates')
      .set('Authorization', headNurse)
      .send({ group: 'STAFF', name: 'Morning', startTime: '08:00', endTime: '15:00', colour: '#2e90fa' })
      .expect(201);
    await request(server())
      .post('/workforce/shift-templates')
      .set('Authorization', headNurse)
      .send({ group: 'DOCTOR', name: 'Day', startTime: '09:00', endTime: '16:00', colour: '#2e90fa' })
      .expect(403);
    await request(server())
      .post('/provider-shifts/locum-slots')
      .set('Authorization', headNurse)
      .send({ clinicId, dates: ['2026-12-07'], startTime: '23:00', endTime: '09:00', locumName: 'Dr Demo Luar' })
      .expect(403);
  });

  it('a month is a draft in My Kuwick until published; changes after are counted', async () => {
    const mine = bearerFor(tenantId, staffId, Role.FRONT_DESK_CLINICAL_STAFF);
    const schedule = async () =>
      (await request(server()).get('/me/schedule?from=2026-12-01&to=2026-12-31').set('Authorization', mine).expect(200)).body.shifts;
    expect((await board()).publication).toMatchObject({ month: '2026-12', publishedAt: null });
    expect(await schedule()).toEqual([]);

    await request(server()).post('/provider-shifts/publish').set('Authorization', headNurse).send({ clinicId, month: '2026-12' }).expect(201);
    expect((await board()).publication).toMatchObject({ publishedBy: 'Demo Ketua Jururawat', changedSince: 0 });
    expect(await schedule()).toEqual([expect.objectContaining({ date: '2026-12-07' })]);

    await addShift(staffId, owner, '2026-12-08').expect(201);
    expect((await board()).publication.changedSince).toBe(1);
    expect(await schedule()).toHaveLength(2);
  });

  it('puts an external locum on by name, on the board and on duty', async () => {
    await request(server())
      .post('/provider-shifts/locum-slots')
      .set('Authorization', owner)
      .send({ clinicId, dates: ['2026-12-07', '2026-12-08'], startTime: '23:00', endTime: '09:00', locumName: '  Dr  Demo Luar ' })
      .expect(201);
    const slots = (await board()).externalLocums;
    expect(slots['2026-12-07']).toEqual([expect.objectContaining({ locumName: 'Dr Demo Luar', startTime: '23:00', endTime: '09:00', crossesMidnight: true })]);
    await request(server()).delete(`/provider-shifts/locum-slots/${slots['2026-12-08'][0].id}`).set('Authorization', owner).expect(200);
    expect((await board()).externalLocums['2026-12-08']).toBeUndefined();
  });
});
