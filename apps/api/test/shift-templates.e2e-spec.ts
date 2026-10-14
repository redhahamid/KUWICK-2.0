import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { bearerFor, createOwnerAndBearer } from './auth';

/**
 * SHIFT TEMPLATES, WEEK START AND OPENING HOURS (UAT, 14 October 2026).
 * Every shift is the clinic's own; the times below are invented for the test.
 * A shift rostered from a template carries its times, break and night flag,
 * and keeps them when the template changes later.
 */
describe('shift templates (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;
  let staffId: string;

  const server = () => app.getHttpServer();
  const post = (path: string, body: Record<string, unknown>, auth = bearer) => request(server()).post(path).set('Authorization', auth).send(body);
  const board = async () =>
    (await request(server()).get(`/provider-shifts/month?clinicId=${clinicId}&month=2026-11`).set('Authorization', bearer).expect(200)).body;
  const cellOf = async (date: string) =>
    (await board()).providers.find((row: { staffId: string }) => row.staffId === staffId).cells[date].shifts as {
      startTime: string;
      endTime: string;
      shiftType: string;
      crossesMidnight: boolean;
      breakMinutes: number;
      night: boolean;
      template: { name: string; colour: string } | null;
    }[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();
    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'Klinik Syif (Synthetic)' } }));
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    clinicId = (await post('/clinics', { name: 'Klinik Syif' }).expect(201)).body.id;
    staffId = (
      await withTenantContext(prisma, tenantId, (tx) =>
        tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Demo Staf Syif', clinicId, active: true } }),
      )
    ).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('keeps each template the clinic defines, and refuses nonsense', async () => {
    const night = (
      await post('/workforce/shift-templates', { group: 'STAFF', name: 'Night', startTime: '21:00', endTime: '07:00', breakMinutes: 60, night: true, colour: '#3355AA' }).expect(201)
    ).body;
    expect(night).toMatchObject({ group: 'STAFF', crossesMidnight: true, workedMinutes: 540, colour: '#3355aa', kind: 'WORKING' });
    await post('/workforce/shift-templates', { group: 'STAFF', name: 'night', startTime: '20:00', endTime: '06:00', colour: '#000000' }).expect(409);
    await post('/workforce/shift-templates', { group: 'STAFF', name: 'Long break', startTime: '09:00', endTime: '10:00', breakMinutes: 60, colour: '#000000' }).expect(400);
    await post('/workforce/shift-templates', { group: 'STAFF', name: 'No times', colour: '#000000' }).expect(400);
    // The same name is allowed in the other group.
    await post('/workforce/shift-templates', { group: 'DOCTOR', name: 'Night', startTime: '22:00', endTime: '08:00', night: true, colour: '#112233' }).expect(201);
    const off = (await post('/workforce/shift-templates', { group: 'STAFF', name: 'Post-night', kind: 'OFF', startTime: '09:00', colour: '#999999' }).expect(201)).body;
    expect(off).toMatchObject({ kind: 'OFF', startTime: null, endTime: null, breakMinutes: 0, night: false });

    const clerk = bearerFor(tenantId, staffId, Role.FRONT_DESK_CLINICAL_STAFF);
    await post('/workforce/shift-templates', { group: 'STAFF', name: 'Sneaky', startTime: '09:00', endTime: '17:00', colour: '#000000' }, clerk).expect(403);

    const staffList = (await request(server()).get('/workforce/shift-templates?group=STAFF').set('Authorization', bearer).expect(200)).body;
    expect(staffList.map((row: { name: string }) => row.name)).toEqual(['Night', 'Post-night']);
  });

  it('rosters from a template: its times, break and night flag go onto the shift and stay there', async () => {
    const templates = (await request(server()).get('/workforce/shift-templates?group=STAFF').set('Authorization', bearer).expect(200)).body;
    const night = templates.find((row: { name: string }) => row.name === 'Night');
    const postNight = templates.find((row: { name: string }) => row.name === 'Post-night');
    await post('/provider-shifts', { clinicId, staffId, dates: ['2026-11-02'], startTime: '09:00', endTime: '17:00', templateId: night.id }).expect(201);
    await post('/provider-shifts', { clinicId, staffId, dates: ['2026-11-03'], startTime: '00:00', endTime: '00:00', templateId: postNight.id }).expect(201);

    expect(await cellOf('2026-11-02')).toEqual([
      expect.objectContaining({ startTime: '21:00', endTime: '07:00', crossesMidnight: true, breakMinutes: 60, night: true, shiftType: 'WORKING', template: expect.objectContaining({ name: 'Night', colour: '#3355aa' }) }),
    ]);
    expect((await cellOf('2026-11-03'))[0]).toMatchObject({ shiftType: 'OFF', template: expect.objectContaining({ name: 'Post-night' }) });

    // Changing the template later does not rewrite the shift already rostered.
    await request(server())
      .put(`/workforce/shift-templates/${night.id}`)
      .set('Authorization', bearer)
      .send({ group: 'STAFF', name: 'Night', startTime: '22:00', endTime: '08:00', breakMinutes: 30, night: true, colour: '#3355aa' })
      .expect(200);
    expect((await cellOf('2026-11-02'))[0]).toMatchObject({ startTime: '21:00', breakMinutes: 60 });

    // Used, so it is retired rather than deleted; the shift keeps its template.
    const removed = (await request(server()).delete(`/workforce/shift-templates/${night.id}`).set('Authorization', bearer).expect(200)).body;
    expect(removed).toMatchObject({ retired: true, rosteredShifts: 1 });
    expect((await cellOf('2026-11-02'))[0].template).toMatchObject({ name: 'Night' });
    await post('/provider-shifts', { clinicId, staffId, dates: ['2026-11-04'], startTime: '09:00', endTime: '17:00', templateId: night.id }).expect(400);
  });

  it('keeps the week start and opening hours as the branch sets them', async () => {
    expect((await board()).weekStartDay).toBe(1);
    expect((await board()).openingHours).toBeNull();
    await post('/workforce/attendance/policy', { weekStartDay: 0, open24Hours: false, openTime: '08:00', closeTime: '23:00' }).expect(201);
    await post('/workforce/attendance/policy', { clinicId, open24Hours: true }).expect(201);
    const now = await board();
    expect(now.weekStartDay).toBe(0);
    expect(now.openingHours).toEqual({ open24Hours: true, openTime: null, closeTime: null });
    await post('/workforce/attendance/policy', { clinicId, open24Hours: false, openTime: '08:00' }).expect(400);
  });
});
