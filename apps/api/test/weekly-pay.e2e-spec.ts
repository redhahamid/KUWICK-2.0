import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();

/**
 * WEEK BY WEEK INTO NEXT MONTH'S PAYROLL (Section C, 14 October 2026).
 *
 * The published roster is the approval. September's weeks are paid in the
 * October run: a nurse's hours past the normal day and week as overtime, a
 * doctor's day hours past the weekly normal as locum hours at their own rate,
 * and their night shift at the night rate. Demo people only.
 */
describe('weekly overtime and locum pay (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;
  let nurseId: string;
  let doctorId: string;

  const server = () => app.getHttpServer();

  /** A rostered shift on a published month, and the person clocked in for it. */
  const rosteredAndWorked = (staffId: string, date: string, start: string, end: string, extra: { breakMinutes?: number; night?: boolean } = {}) =>
    withTenantContext(prisma, tenantId, async (tx) => {
      const startsAt = new Date(`${date}T${start}:00.000Z`);
      let endsAt = new Date(`${date}T${end}:00.000Z`);
      if (endsAt <= startsAt) endsAt = new Date(endsAt.getTime() + 86_400_000);
      await tx.providerShift.create({
        data: {
          tenantId,
          clinicId,
          staffId,
          shiftDate: new Date(`${date}T00:00:00.000Z`),
          startsAt,
          endsAt,
          breakMinutes: extra.breakMinutes ?? 0,
          night: extra.night ?? false,
        },
      });
      await tx.attendanceRecord.create({
        data: {
          tenantId,
          staffId,
          clinicId,
          workDate: new Date(`${date}T00:00:00.000Z`),
          status: 'PRESENT',
          clockInAt: startsAt,
          clockOutAt: endsAt,
          workedMinutes: Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000) - (extra.breakMinutes ?? 0),
        },
      });
    });

  const hire = async (staffId: string, employeeNo: string, salary: string) => {
    await request(server())
      .post(`/workforce/employees/${staffId}`)
      .set('Authorization', bearer)
      .send({ employeeNo, position: 'Demo', employmentType: 'PERMANENT', employmentStatus: 'ACTIVE', startDate: '2024-01-01', dateOfBirth: '1990-01-01' })
      .expect(201);
    await request(server())
      .post(`/workforce/employees/${staffId}/statutory-classification`)
      .set('Authorization', bearer)
      .send({
        effectiveFrom: '2024-01-01',
        epfMembership: 'MALAYSIAN_CITIZEN',
        taxResidence: 'RESIDENT',
        pcbCategory: 'CATEGORY_1',
        qualifyingChildren: 0,
        restDayOfWeek: 0,
        lindungParticipation: 'NOT_PARTICIPATING',
        reason: 'Recorded at hire',
      })
      .expect(201);
    await request(server())
      .post(`/workforce/employees/${staffId}/salary`)
      .set('Authorization', bearer)
      .send({ amount: salary, basis: 'MONTHLY', effectiveFrom: '2024-01-01', reason: 'Starting salary' })
      .expect(201);
  };

  let runId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'Weekly Pay Tenant' } }));
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    clinicId = (await request(server()).post('/clinics').set('Authorization', bearer).send({ name: 'Weekly Clinic' }).expect(201)).body.id;
    const legalEmployerId = (await request(server()).post('/workforce/legal-employers').set('Authorization', bearer).send({ name: 'Weekly Sdn Bhd' }).expect(201)).body.id;
    await request(server()).post('/workforce/pay-components/seed').set('Authorization', bearer).expect(201);
    await request(server())
      .post('/workforce/payroll-policies')
      .set('Authorization', bearer)
      .send({ name: 'Clinic rules', overtimeBasis: 'ACT', weeklyNormalHours: 45, locumHourlyRate: '45.00', isDefault: true })
      .expect(201);

    const [nurse, doctor] = await withTenantContext(prisma, tenantId, (tx) =>
      Promise.all([
        tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Demo Nurse Week', clinicId } }),
        tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, staffGroup: 'DOCTOR', fullName: 'Demo Doctor Week', clinicId } }),
      ]),
    );
    nurseId = nurse.id;
    doctorId = doctor.id;
    await hire(nurseId, 'WK-1', '2600.00');
    await hire(doctorId, 'WK-2', '12000.00');
    for (const id of [nurseId, doctorId]) {
      await request(server()).patch(`/workforce/employees/${id}/legal-employer`).set('Authorization', bearer).send({ legalEmployerId }).expect(200);
    }
    await request(server())
      .patch(`/workforce/employees/${doctorId}/doctor-rates`)
      .set('Authorization', bearer)
      .send({ locumRate: '50.00', nightPayMode: 'PER_SHIFT', nightRate: '350.00' })
      .expect(200);

    await withTenantContext(prisma, tenantId, (tx) =>
      tx.rosterPublication.create({ data: { tenantId, clinicId, month: '2026-09', publishedAt: new Date() } }),
    );
    // Week Mon 7 – Sun 13 September. Nurse: six 8-hour days (9 hours less a 1-hour break).
    for (const date of ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12']) {
      await rosteredAndWorked(nurseId, date, '01:00', '10:00', { breakMinutes: 60 });
    }
    // Doctor: five 10-hour days, and a night shift on the Saturday.
    for (const date of ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']) {
      await rosteredAndWorked(doctorId, date, '00:00', '10:00');
    }
    await rosteredAndWorked(doctorId, '2026-09-12', '13:00', '00:00', { night: true });

    runId = (await request(server()).post('/workforce/payroll/runs').set('Authorization', bearer).send({ period: '2026-10', clinicId }).expect(201)).body.id;
    await request(server()).patch(`/workforce/payroll/runs/${runId}/calculate`).set('Authorization', bearer).expect(200);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const itemsOf = async (staffId: string) =>
    (await request(server()).get(`/workforce/payroll/inputs?period=2026-10&staffId=${staffId}`).set('Authorization', bearer).expect(200)).body as {
      componentCode: string;
      earnedPeriod: string | null;
      amount: string;
    }[];

  it("pays a nurse's hours past the normal day as overtime in the next month, earned in September", async () => {
    const overtime = (await itemsOf(nurseId)).filter((row) => row.componentCode === 'OVERTIME');
    expect(overtime).toHaveLength(1);
    expect(overtime[0].earnedPeriod?.slice(0, 7)).toBe('2026-09');
    // 6 days × 30 minutes past the 7.5-hour day = 3 hours at 1.5× the hourly rate of RM2,600.
    expect(Number(overtime[0].amount)).toBeCloseTo(3 * 1.5 * (2600 / 26 / 7.5), 1);

    const weeks = (await request(server()).get(`/workforce/payroll/runs/${runId}/employees/${nurseId}/weeks`).set('Authorization', bearer).expect(200))
      .body as { weekStart: string; working: { overtimeMinutes: number; dailyOvertimeMinutes: number } }[];
    expect(weeks.map((week) => week.weekStart)).toEqual(['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21']);
    expect(weeks[1].working.overtimeMinutes).toBe(180);
  });

  it("pays a doctor's day hours past the weekly normal at their own locum rate, and the night shift apart", async () => {
    const items = await itemsOf(doctorId);
    const locum = items.find((row) => row.componentCode === 'LOCUM_FEE');
    const night = items.find((row) => row.componentCode === 'NIGHT_INCENTIVE');
    // 50 hours against 45: 5 hours × RM50. The night shift is outside the weekly hours.
    expect(Number(locum?.amount)).toBe(250);
    expect(Number(night?.amount)).toBe(350);
    expect(items.some((row) => row.componentCode === 'OVERTIME')).toBe(false);
  });

  it('refuses an overtime wage limit below the Act', async () => {
    await request(server())
      .post('/workforce/payroll-policies')
      .set('Authorization', bearer)
      .send({ name: 'Too low', overtimeWageCeiling: '3500.00' })
      .expect(400);
  });
});
