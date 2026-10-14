import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, ProviderShiftType, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

/**
 * ROSTER VIEWS (UAT, 14 October 2026): a week from the branch's own week
 * start, and the combined "on duty today": working and locum shifts only,
 * with last night's shift still running. Demo people only.
 */
describe('roster views (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;
  const people: Record<string, string> = {};

  const server = () => app.getHttpServer();
  const week = async (start: string) =>
    (await request(server()).get(`/provider-shifts/week?clinicId=${clinicId}&start=${start}`).set('Authorization', bearer).expect(200)).body;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();
    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'Klinik Pandangan (Synthetic)' } }));
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    clinicId = (await request(server()).post('/clinics').set('Authorization', bearer).send({ name: 'Klinik Pandangan' }).expect(201)).body.id;
    for (const [key, role, fullName] of [
      ['doctor', Role.DOCTOR_RESIDENT, 'Dr Demo Malam'],
      ['staff', Role.FRONT_DESK_CLINICAL_STAFF, 'Demo Staf Pagi'],
      ['off', Role.FRONT_DESK_CLINICAL_STAFF, 'Demo Staf Cuti'],
      ['done', Role.FRONT_DESK_CLINICAL_STAFF, 'Demo Staf Semalam'],
    ] as const) {
      people[key] = (await withTenantContext(prisma, tenantId, (tx) => tx.staff.create({ data: { tenantId, role, fullName, clinicId, active: true } }))).id;
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('shows seven days from the branch week start, whichever day is asked for', async () => {
    expect((await week('2026-11-04')).dates).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
    await request(server()).post('/workforce/attendance/policy').set('Authorization', bearer).send({ clinicId, weekStartDay: 0 }).expect(201);
    const sunday = await week('2026-11-04');
    expect(sunday.dates[0]).toBe('2026-11-01');
    expect(sunday.weekStartDay).toBe(0);
    await request(server()).get(`/provider-shifts/week?clinicId=${clinicId}&start=next-week`).set('Authorization', bearer).expect(400);
  });

  it('on duty today: working shifts and last night’s still running, not OFF', async () => {
    const before = (await request(server()).get(`/workforce/today?clinicId=${clinicId}`).set('Authorization', bearer).expect(200)).body;
    const today = new Date(`${before.date}T00:00:00.000Z`);
    const yesterday = new Date(today.getTime() - 86_400_000);
    const now = Date.now();
    const hour = 3_600_000;
    const shift = (staffId: string, shiftDate: Date, from: number, to: number, shiftType: ProviderShiftType = ProviderShiftType.WORKING) => ({
      tenantId,
      clinicId,
      staffId,
      shiftDate,
      startsAt: new Date(from),
      endsAt: new Date(to),
      shiftType,
    });
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.providerShift.createMany({
        data: [
          shift(people.doctor, yesterday, now - 6 * hour, now + 4 * hour),
          shift(people.done, yesterday, now - 12 * hour, now - 2 * hour),
          shift(people.staff, today, now + hour, now + 8 * hour),
          shift(people.off, today, now + hour, now + 8 * hour, ProviderShiftType.OFF),
        ],
      }),
    );
    const board = (await request(server()).get(`/workforce/today?clinicId=${clinicId}`).set('Authorization', bearer).expect(200)).body;
    const names = board.scheduled.map((row: { name: string }) => row.name).sort();
    expect(names).toEqual(['Demo Staf Pagi', 'Dr Demo Malam']);
    expect(board.scheduled.find((row: { name: string }) => row.name === 'Dr Demo Malam')).toMatchObject({ group: 'DOCTOR', fromYesterday: true, clinicName: 'Klinik Pandangan' });
    expect(board.scheduled.find((row: { name: string }) => row.name === 'Demo Staf Pagi')).toMatchObject({ group: 'STAFF', fromYesterday: false, clockedIn: false });
    // Last night's shift is not "not clocked in" today; the OFF day is nobody's.
    expect(board.notClockedIn.map((row: { name: string }) => row.name)).toEqual(['Demo Staf Pagi']);
  });

  it('an owner recorded as a doctor is on the doctor side of the board (UAT, 14 October 2026)', async () => {
    const partner = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.OWNER_ADMIN, fullName: 'Dr Demo Pemilik', clinicId, active: true } }),
    );
    const ownerRow = async () =>
      (await request(server()).get(`/provider-shifts/month?clinicId=${clinicId}&month=2026-11`).set('Authorization', bearer).expect(200)).body.providers.find(
        (row: { staffId: string }) => row.staffId === partner.id,
      );
    expect((await ownerRow()).category).toBe('MANAGEMENT');
    const ownerId = (await ownerRow()).staffId;
    await request(server()).patch(`/workforce/employees/${ownerId}/group`).set('Authorization', bearer).send({ staffGroup: 'DOCTOR' }).expect(200);
    expect((await ownerRow()).category).toBe('DOCTOR');
    await request(server()).patch(`/workforce/employees/${ownerId}/group`).set('Authorization', bearer).send({ staffGroup: 'NURSE' }).expect(400);
    await request(server()).patch(`/workforce/employees/${ownerId}/group`).set('Authorization', bearer).send({ staffGroup: null }).expect(200);
    expect((await ownerRow()).category).toBe('MANAGEMENT');
  });
  it('lists every employee of the branch employed in the month, login or not, and nobody who had left (UAT, 15 October 2026)', async () => {
    const hire = async (fullName: string, extra: Record<string, unknown>) =>
      (
        await request(server())
          .post('/workforce/employees')
          .set('Authorization', bearer)
          .send({ fullName, role: Role.FRONT_DESK_CLINICAL_STAFF, employmentType: 'PERMANENT', employmentStatus: 'ACTIVE', startDate: '2025-01-01', ...extra })
          .expect(201)
      ).body.staffId as string;
    const here = await hire('Demo Pembantu Klinik', { clinicId });
    const noBranch = await hire('Demo Tanpa Cawangan', {});
    const left = await hire('Demo Sudah Berhenti', { clinicId, employmentStatus: 'RESIGNED', endDate: '2026-09-30' });
    const rows = (await request(server()).get(`/provider-shifts/month?clinicId=${clinicId}&month=2026-11`).set('Authorization', bearer).expect(200)).body
      .providers as { staffId: string; noBranch?: boolean }[];
    expect(rows.find((row) => row.staffId === here)?.noBranch).toBe(false);
    expect(rows.find((row) => row.staffId === noBranch)?.noBranch).toBe(true);
    expect(rows.some((row) => row.staffId === left)).toBe(false);
    // Add shift works for an employee with no login.
    await request(server())
      .post('/provider-shifts')
      .set('Authorization', bearer)
      .send({ clinicId, staffId: here, dates: ['2026-11-03'], startTime: '08:00', endTime: '16:00', shiftType: 'WORKING' })
      .expect(201);
  });
  it('the owner roster check says who was considered and why anybody was left off (UAT, 15 October 2026)', async () => {
    const other = (await request(server()).post('/clinics').set('Authorization', bearer).send({ name: 'Klinik Lain' }).expect(201)).body.id;
    await request(server())
      .post('/workforce/employees')
      .set('Authorization', bearer)
      .send({ fullName: 'Demo Cawangan Lain', role: Role.FRONT_DESK_CLINICAL_STAFF, clinicId: other, employmentType: 'PERMANENT', employmentStatus: 'ACTIVE' })
      .expect(201);
    const check = (await request(server()).get(`/provider-shifts/roster-check?clinicId=${clinicId}&month=2026-11`).set('Authorization', bearer).expect(200))
      .body;
    expect(check.apiBuild).toEqual(expect.any(String));
    expect(check.included).toBeGreaterThan(0);
    expect(check.excluded).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Demo Sudah Berhenti', reason: 'Left 2026-09-30, before this period' })]));
    expect(check.inOtherBranches).toEqual([{ branch: 'Klinik Lain', count: 1 }]);
    // The board agrees with the check, and a doctor is on it whatever their booking mode.
    const board = (await request(server()).get(`/provider-shifts/month?clinicId=${clinicId}&month=2026-11`).set('Authorization', bearer).expect(200)).body;
    expect(board.providers.length).toBe(check.included);
    expect(board.providers.some((row: { staffId: string }) => row.staffId === people.doctor)).toBe(true);
  });
});
