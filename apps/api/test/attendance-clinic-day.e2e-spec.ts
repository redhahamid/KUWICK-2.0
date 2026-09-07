import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, ProviderShiftType, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

/**
 * A PUNCH BELONGS TO THE DAY THE CLINIC IS HAVING, NOT THE DAY UTC IS HAVING.
 *
 * Malaysia is UTC+8, so for a third of every day the two disagree, and the
 * attendance service used to file by the UTC date. A nurse clocking in at
 * 07:00 in Kuala Lumpur is clocking in at 23:00 UTC the day BEFORE: her
 * morning was filed against yesterday, her clock-out at 15:00 local landed on
 * today, found no open record, and opened a second one with no clock-in. Two
 * broken records, no hours, and nothing on screen to explain it.
 *
 * These drive the real HTTP endpoint against a real database, because the
 * failure was in which row the service chose — something a unit test of the
 * arithmetic cannot see.
 */
describe('Attendance files against the clinic-local day (e2e)', () => {
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
      tx.tenant.create({ data: { id: tenantId, name: 'Klinik Masa (Synthetic)' } }),
    );
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    const clinic = await request(server())
      .post('/clinics')
      .set('Authorization', bearer)
      .send({ name: 'Klinik Masa' })
      .expect(201);
    clinicId = clinic.body.id;
    // Explicit rather than assumed: these tests are ABOUT the offset.
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.clinic.update({ where: { id: clinicId }, data: { timezone: 'Asia/Kuala_Lumpur' } }),
    );
  });

  async function makeStaff(fullName: string): Promise<string> {
    const staff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName, clinicId } }),
    );
    return staff.id;
  }

  /** A roster shift, in clinic wall-clock terms, written as the roster writes it. */
  async function rosterShift(staffId: string, shiftDate: string, startUtc: string, endUtc: string) {
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.providerShift.create({
        data: {
          tenantId,
          clinicId,
          staffId,
          shiftDate: new Date(`${shiftDate}T00:00:00.000Z`),
          startsAt: new Date(startUtc),
          endsAt: new Date(endUtc),
          shiftType: ProviderShiftType.WORKING,
        },
      }),
    );
  }

  const clock = (staffId: string, at: string) =>
    request(server()).post('/workforce/attendance/clock').set('Authorization', bearer).send({ staffId, clinicId, at });

  const recordsFor = (staffId: string) =>
    withTenantContext(prisma, tenantId, (tx) =>
      tx.attendanceRecord.findMany({ where: { staffId }, orderBy: { workDate: 'asc' } }),
    );

  // -------------------------------------------------------------------------
  it('files a 07:00 Malaysian clock-in against THAT day, not the UTC day before', async () => {
    const staffId = await makeStaff('Pagi Ujian');
    // 07:00 on 10 September in Kuala Lumpur is 23:00 on the 9th in UTC.
    await rosterShift(staffId, '2026-09-10', '2026-09-09T23:00:00.000Z', '2026-09-10T08:00:00.000Z');

    await clock(staffId, '2026-09-09T23:00:00.000Z').expect(201);
    const out = await clock(staffId, '2026-09-10T08:00:00.000Z').expect(201);

    const rows = await recordsFor(staffId);
    // ONE record, on the 10th. Filed by UTC this was two rows on the 9th and
    // the 10th, neither of them a day's work.
    expect(rows).toHaveLength(1);
    expect(rows[0].workDate.toISOString().slice(0, 10)).toBe('2026-09-10');
    expect(out.body.workedMinutes).toBe(540);
    // And the roster was found, so lateness was measured rather than skipped.
    expect(rows[0].scheduledStart).not.toBeNull();
    expect(rows[0].lateMinutes).toBe(0);
  });

  it('measures lateness against the shift the roster planned for that local day', async () => {
    const staffId = await makeStaff('Lewat Ujian');
    // 08:00–17:00 Kuala Lumpur on 11 September.
    await rosterShift(staffId, '2026-09-11', '2026-09-11T00:00:00.000Z', '2026-09-11T09:00:00.000Z');

    // 08:12 local. Twelve minutes late, seven of them past the five-minute grace.
    await clock(staffId, '2026-09-11T00:12:00.000Z').expect(201);
    const rows = await recordsFor(staffId);
    expect(rows[0].lateMinutes).toBe(7);
    expect(rows[0].status).toBe('MISSING_PUNCH');
  });

  // -------------------------------------------------------------------------
  it('keeps a 23:00→07:00 overnight shift as ONE record on the day it started', async () => {
    const staffId = await makeStaff('Malam Ujian');
    // 23:00 on the 12th to 07:00 on the 13th, Kuala Lumpur.
    await rosterShift(staffId, '2026-09-12', '2026-09-12T15:00:00.000Z', '2026-09-13T23:00:00.000Z');

    await clock(staffId, '2026-09-12T15:00:00.000Z').expect(201);
    // Clocks out at 07:00 local on the 13th — a different clinic day.
    const out = await clock(staffId, '2026-09-12T23:00:00.000Z').expect(201);

    const rows = await recordsFor(staffId);
    expect(rows).toHaveLength(1);
    expect(rows[0].workDate.toISOString().slice(0, 10)).toBe('2026-09-12');
    expect(out.body.workedMinutes).toBe(480);
    expect(out.body.clockOutAt).not.toBeNull();
  });

  it('does NOT let a forgotten clock-out swallow the next morning’s clock-in', async () => {
    const staffId = await makeStaff('Lupa Ujian');
    // A normal 08:00–17:00 day on the 14th, and another on the 15th.
    await rosterShift(staffId, '2026-09-14', '2026-09-14T00:00:00.000Z', '2026-09-14T09:00:00.000Z');
    await rosterShift(staffId, '2026-09-15', '2026-09-15T00:00:00.000Z', '2026-09-15T09:00:00.000Z');

    await clock(staffId, '2026-09-14T00:00:00.000Z').expect(201); // in, never out
    await clock(staffId, '2026-09-15T00:00:00.000Z').expect(201); // next morning

    const rows = await recordsFor(staffId);
    // Two days, two records. The 14th keeps its missing punch for somebody to
    // resolve; the 15th is a fresh day, not a sixteen-hour shift.
    expect(rows.map((row) => row.workDate.toISOString().slice(0, 10))).toEqual(['2026-09-14', '2026-09-15']);
    expect(rows[0].clockOutAt).toBeNull();
    expect(rows[0].status).toBe('MISSING_PUNCH');
    expect(rows[1].clockInAt).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  it('measures by the CLINIC’s policy, not by one grace period for everybody', async () => {
    const staffId = await makeStaff('Polisi Ujian');
    await rosterShift(staffId, '2026-09-16', '2026-09-16T00:00:00.000Z', '2026-09-16T09:00:00.000Z');

    // This clinic allows fifteen minutes.
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.attendancePolicy.create({ data: { tenantId, clinicId, lateGraceMinutes: 15 } }),
    );

    await clock(staffId, '2026-09-16T00:12:00.000Z').expect(201);
    const rows = await recordsFor(staffId);
    // Twelve minutes late is not late here. Under the built-in five it was.
    expect(rows[0].lateMinutes).toBe(0);
  });

  it('records the overtime CANDIDATE the clinic would pay, not raw extra minutes', async () => {
    const staffId = await makeStaff('Lebih Ujian');
    await rosterShift(staffId, '2026-09-17', '2026-09-17T00:00:00.000Z', '2026-09-17T09:00:00.000Z');

    await clock(staffId, '2026-09-17T00:00:00.000Z').expect(201);
    // Out at 18:05 local — 65 minutes past the scheduled end.
    const out = await clock(staffId, '2026-09-17T10:05:00.000Z').expect(201);

    // Past the 30-minute minimum, rounded down to the quarter hour: 60.
    expect(out.body.overtimeMinutes).toBe(60);
    // AND STILL NOT PAID. Extra time is not overtime until somebody approves it.
    expect(out.body.overtimeApproved).toBe(false);
  });

  it('does not treat eight minutes of tidying up as a claim on the payroll', async () => {
    const staffId = await makeStaff('Kemas Ujian');
    await rosterShift(staffId, '2026-09-18', '2026-09-18T00:00:00.000Z', '2026-09-18T09:00:00.000Z');

    await clock(staffId, '2026-09-18T00:00:00.000Z').expect(201);
    const out = await clock(staffId, '2026-09-18T09:08:00.000Z').expect(201);

    expect(out.body.overtimeMinutes).toBe(0);
  });
});
