import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

/**
 * ONE ROSTER, FOR EVERYBODY WHO WORKS HERE.
 *
 * The monthly matrix used to read `role IN (DOCTOR_RESIDENT, DOCTOR_LOCUM)`,
 * so a receptionist could not be scheduled at all. The table never had that
 * limit — `ProviderShift.staffId` is any staff member and `create()` never had
 * a doctor guard — only the read did.
 *
 * The one thing this widening must NOT do is widen what the appointment engine
 * offers. A receptionist's shift is a real shift and not a bookable slot, and
 * the last test here is the one that holds that line.
 */
describe('The roster holds the whole workforce (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;

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
      tx.tenant.create({ data: { id: tenantId, name: 'Klinik Jadual (Synthetic)' } }),
    );
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    const clinic = await request(server())
      .post('/clinics')
      .set('Authorization', bearer)
      .send({ name: 'Klinik Jadual' })
      .expect(201);
    clinicId = clinic.body.id;
  });

  async function makeStaff(fullName: string, role: Role): Promise<string> {
    const staff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role, fullName, clinicId, active: true } }),
    );
    return staff.id;
  }

  const monthBoard = (query = '') =>
    request(server())
      .get(`/provider-shifts/month?clinicId=${clinicId}&month=2026-09${query}`)
      .set('Authorization', bearer)
      .expect(200);

  // -------------------------------------------------------------------------
  it('puts the receptionist on the board beside the doctor', async () => {
    await makeStaff('Dr Aminah Ujian', Role.DOCTOR_RESIDENT);
    await makeStaff('Siti Kaunter Ujian', Role.FRONT_DESK_CLINICAL_STAFF);
    await makeStaff('Rahim Kewangan Ujian', Role.FINANCE_STAFF);

    const board = await monthBoard();
    const names = board.body.providers.map((row: { fullName: string }) => row.fullName);
    expect(names).toEqual(
      expect.arrayContaining(['Dr Aminah Ujian', 'Siti Kaunter Ujian', 'Rahim Kewangan Ujian']),
    );
  });

  it('says which part of the workforce each person is, and counts them all', async () => {
    await makeStaff('Dr Aminah Ujian', Role.DOCTOR_RESIDENT);
    await makeStaff('Siti Kaunter Ujian', Role.FRONT_DESK_CLINICAL_STAFF);
    await makeStaff('Rahim Kewangan Ujian', Role.FINANCE_STAFF);

    const board = await monthBoard();
    const byName = new Map<string, { category: string; bookable: boolean }>(
      board.body.providers.map((row: { fullName: string; category: string; bookable: boolean }) => [
        row.fullName,
        row,
      ]),
    );
    expect(byName.get('Dr Aminah Ujian')).toMatchObject({ category: 'DOCTOR', bookable: true });
    expect(byName.get('Siti Kaunter Ujian')).toMatchObject({ category: 'ADMIN', bookable: false });
    expect(byName.get('Rahim Kewangan Ujian')).toMatchObject({ category: 'MANAGEMENT', bookable: false });

    // The owner created by the fixture is management too, so this is at least 2.
    expect(board.body.categoryCounts.DOCTOR).toBe(1);
    expect(board.body.categoryCounts.ADMIN).toBe(1);
    expect(board.body.categoryCounts.MANAGEMENT).toBeGreaterThanOrEqual(1);
  });

  it('filters to one category while still reporting the counts of all of them', async () => {
    await makeStaff('Dr Aminah Ujian', Role.DOCTOR_RESIDENT);
    await makeStaff('Siti Kaunter Ujian', Role.FRONT_DESK_CLINICAL_STAFF);

    const board = await monthBoard('&category=DOCTOR');
    expect(board.body.providers).toHaveLength(1);
    expect(board.body.providers[0].fullName).toBe('Dr Aminah Ujian');
    // A chip reading "Admin 1" that vanishes the moment you click Doctors is a
    // filter that has forgotten what it is filtering.
    expect(board.body.categoryCounts.ADMIN).toBe(1);
  });

  it('does not report a scheduling mode for somebody who takes no bookings', async () => {
    const staffId = await makeStaff('Siti Kaunter Ujian', Role.FRONT_DESK_CLINICAL_STAFF);
    const board = await monthBoard();
    const row = board.body.providers.find((entry: { staffId: string }) => entry.staffId === staffId);
    // FIXED_WEEKLY means "a standing pattern decides availability", which is a
    // sentence about appointments. A receptionist has none to decide.
    expect(row.scheduleMode).toBe('ROSTER_LINKED');
    expect(row.upcomingChanges).toEqual([]);
  });

  it('schedules a non-provider’s shift, and shows it in their cell', async () => {
    const staffId = await makeStaff('Siti Kaunter Ujian', Role.FRONT_DESK_CLINICAL_STAFF);

    await request(server())
      .post('/provider-shifts')
      .set('Authorization', bearer)
      .send({ clinicId, staffId, dates: ['2026-09-08'], startTime: '08:00', endTime: '17:00' })
      .expect(201);

    const board = await monthBoard();
    const row = board.body.providers.find((entry: { staffId: string }) => entry.staffId === staffId);
    expect(row.cells['2026-09-08'].shifts).toHaveLength(1);
    expect(row.cells['2026-09-08'].shifts[0]).toMatchObject({ startTime: '08:00', endTime: '17:00' });
  });

  it('keeps an overnight shift as ONE cell on the day it starts, flagged as crossing midnight', async () => {
    const staffId = await makeStaff('Malam Ujian', Role.FRONT_DESK_CLINICAL_STAFF);

    await request(server())
      .post('/provider-shifts')
      .set('Authorization', bearer)
      .send({ clinicId, staffId, dates: ['2026-09-09'], startTime: '23:00', endTime: '07:00' })
      .expect(201);

    const board = await monthBoard();
    const row = board.body.providers.find((entry: { staffId: string }) => entry.staffId === staffId);
    expect(row.cells['2026-09-09'].shifts).toHaveLength(1);
    expect(row.cells['2026-09-09'].shifts[0].crossesMidnight).toBe(true);
    // And nothing spilled onto the 10th.
    expect(row.cells['2026-09-10'].shifts).toHaveLength(0);
  });

  it('holds two shifts in one day for one person', async () => {
    const staffId = await makeStaff('Pecah Ujian', Role.FRONT_DESK_CLINICAL_STAFF);
    for (const [startTime, endTime] of [
      ['08:00', '12:00'],
      ['18:00', '22:00'],
    ]) {
      await request(server())
        .post('/provider-shifts')
        .set('Authorization', bearer)
        .send({ clinicId, staffId, dates: ['2026-09-11'], startTime, endTime })
        .expect(201);
    }

    const board = await monthBoard();
    const row = board.body.providers.find((entry: { staffId: string }) => entry.staffId === staffId);
    expect(row.cells['2026-09-11'].shifts).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  /**
   * THE LINE THIS CHANGE MUST NOT CROSS.
   *
   * A receptionist now has shifts on the same board and in the same table as a
   * doctor. If that made their hours bookable, the widening would have quietly
   * turned every front-desk shift into appointment capacity.
   */
  it('REFUSES to book an appointment into a non-provider’s shift', async () => {
    const staffId = await makeStaff('Siti Kaunter Ujian', Role.FRONT_DESK_CLINICAL_STAFF);
    await request(server())
      .post('/provider-shifts')
      .set('Authorization', bearer)
      .send({ clinicId, staffId, dates: ['2026-09-08'], startTime: '08:00', endTime: '17:00' })
      .expect(201);

    const patient = await withTenantContext(prisma, tenantId, (tx) =>
      tx.patient.create({
        data: {
          tenantId,
          name: 'Ujian Pesakit',
          phone: '0123456789',
          identifierType: 'NRIC',
          identifierValue: `9001010${Math.floor(Math.random() * 90000) + 10000}`,
        },
      }),
    );

    const refused = await request(server())
      .post('/appointments')
      .set('Authorization', bearer)
      .send({
        clinicId,
        staffId,
        patientId: patient.id,
        startAt: '2026-09-08T01:00:00.000Z',
        durationMinutes: 30,
      });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(refused.status).not.toBe(201);
  });
});
