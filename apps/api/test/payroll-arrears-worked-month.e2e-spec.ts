import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();

/**
 * OVERTIME A MONTH IN ARREARS, PRICED AS THE MONTH IT WAS WORKED (UAT,
 * 10 October 2026): "use the rest day and rule set of the month the overtime
 * was worked, not the paying month."
 *
 * The nurse's rest day is Sunday until October, Saturday from October. Her
 * rule set pays the Act's formula in September and the clinic's own rates
 * from October. September's Saturday and Sunday are paid in the October run:
 * the Saturday as a normal day's overtime, the Sunday as a rest day, both at
 * the Act's formula, because that is what September was. October's own
 * Saturday, paid in November with no approved October behind it, is a rest
 * day at the clinic's rates: the rule set in force prices a month that was
 * never approved.
 */
describe('arrears overtime priced as the month it was worked (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;
  let staffId: string;
  let legalEmployerId: string;
  let ruleSetId: string;
  const days: Record<string, string> = {};

  const server = () => app.getHttpServer();
  const worked = async (date: string) => {
    const row = await withTenantContext(prisma, tenantId, (tx) =>
      tx.attendanceRecord.create({
        data: {
          tenantId,
          staffId,
          clinicId,
          workDate: new Date(`${date}T00:00:00.000Z`),
          status: 'PRESENT',
          workedMinutes: 570,
          overtimeMinutes: 120,
          overtimeApproved: true,
        },
      }),
    );
    days[date] = row.id;
  };
  const run = async (period: string, approve: boolean) => {
    const id = (await request(server()).post('/workforce/payroll/runs').set('Authorization', bearer).send({ period, clinicId }).expect(201)).body.id;
    await request(server()).patch(`/workforce/payroll/runs/${id}/calculate`).set('Authorization', bearer).expect(200);
    if (approve) await request(server()).patch(`/workforce/payroll/runs/${id}/approve`).set('Authorization', bearer).send({ acknowledgeStatutoryGap: true }).expect(200);
    return id;
  };
  const paid = (period: string, date: string) =>
    withTenantContext(prisma, tenantId, (tx) =>
      tx.payrollInputEntry.findFirstOrThrow({
        where: { staffId, period: new Date(`${period}-01T00:00:00.000Z`), componentCode: 'OVERTIME', sourceRecordId: days[date] },
        select: { label: true, reason: true, amount: true, earnedPeriod: true },
      }),
    );
  const ruleSet = (body: Record<string, unknown>) =>
    request(server())
      .post('/workforce/payroll-policies')
      .set('Authorization', bearer)
      .send({ name: 'Nurses', legalEmployerId, isDefault: true, overtimeDays: 26, overtimeHoursPerDay: 8, ...body });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'Worked Month Tenant' } }));
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    clinicId = (await request(server()).post('/clinics').set('Authorization', bearer).send({ name: 'Worked Month Clinic' }).expect(201)).body.id;
    legalEmployerId = (await request(server()).post('/workforce/legal-employers').set('Authorization', bearer).send({ name: 'Worked Month Sdn Bhd' }).expect(201)).body.id;
    await request(server()).post('/workforce/pay-components/seed').set('Authorization', bearer).expect(201);
    await request(server()).patch('/workforce/pay-components/OVERTIME/pay-date').set('Authorization', bearer).send({ payDay: 15, paidInArrears: true }).expect(200);
    ruleSetId = (await ruleSet({ overtimeMode: 'STATUTORY' }).expect(201)).body.id;

    staffId = (
      await withTenantContext(prisma, tenantId, (tx) =>
        tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Demo Nurse', clinicId } }),
      )
    ).id;
    await request(server())
      .post(`/workforce/employees/${staffId}`)
      .set('Authorization', bearer)
      .send({ employeeNo: 'WM-1', position: 'Nurse', employmentType: 'PERMANENT', employmentStatus: 'ACTIVE', startDate: '2024-01-01', dateOfBirth: '1994-04-04' })
      .expect(201);
    const standing = (effectiveFrom: string, restDayOfWeek: number, reason: string) =>
      request(server())
        .post(`/workforce/employees/${staffId}/statutory-classification`)
        .set('Authorization', bearer)
        .send({
          effectiveFrom,
          epfMembership: 'MALAYSIAN_CITIZEN',
          taxResidence: 'RESIDENT',
          pcbCategory: 'CATEGORY_1',
          qualifyingChildren: 0,
          restDayOfWeek,
          lindungParticipation: 'NOT_PARTICIPATING',
          reason,
        })
        .expect(201);
    await standing('2024-01-01', 0, 'Recorded at hire');
    await standing('2026-10-01', 6, 'Rest day moves to Saturday');
    await request(server()).patch(`/workforce/employees/${staffId}/legal-employer`).set('Authorization', bearer).send({ legalEmployerId }).expect(200);
    await request(server())
      .post(`/workforce/employees/${staffId}/salary`)
      .set('Authorization', bearer)
      .send({ amount: '3000.00', basis: 'MONTHLY', effectiveFrom: '2024-01-01', reason: 'Starting salary' })
      .expect(201);

    await worked('2026-09-12'); // a Saturday: a normal day in September
    await worked('2026-09-13'); // a Sunday: September's rest day
    await worked('2026-10-10'); // a Saturday: October's rest day
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('prices last month’s days by last month’s rest day and rule set', async () => {
    await run('2026-09', true);
    // From October the rule set pays the clinic's own rates.
    await ruleSet({
      id: ruleSetId,
      overtimeMode: 'CLINIC_RATE',
      clinicOvertimeHourly: '50.00',
      clinicRestDayShift: '400.00',
      clinicPublicHolidayShift: '500.00',
      clinicSessionRate: '250.00',
    }).expect(201);
    await run('2026-10', false);

    const saturday = await paid('2026-10', '2026-09-12');
    expect(saturday.label).toBe('Overtime');
    expect(saturday.reason).toMatch(/2\.00h overtime at 1\.5×/);
    expect(saturday.earnedPeriod?.toISOString().slice(0, 10)).toBe('2026-09-01');

    const sunday = await paid('2026-10', '2026-09-13');
    expect(sunday.label).toBe('Rest day pay');
    expect(sunday.reason).not.toMatch(/clinic|RM400/i);
  });

  it('prices a month never approved by the rule set in force, on that month’s own rest day', async () => {
    await run('2026-11', false);
    const saturday = await paid('2026-11', '2026-10-10');
    expect(saturday.label).toBe('Rest day pay');
    expect(saturday.reason).toMatch(/Clinic rate, Nurses/);
    // The shift, plus the hour and a half beyond an 8-hour day at RM50.
    expect(Number(saturday.amount)).toBe(475);
  });
});
