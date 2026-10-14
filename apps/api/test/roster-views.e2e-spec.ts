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
});
