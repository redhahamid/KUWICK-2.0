import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();

/**
 * A BACK-DATED MONTH PAYS WHO WORKED THAT MONTH (UAT, 10 October 2026).
 *
 * "A month's run must include everyone employed at any point in THAT month:
 * start date on or before the month's last day, AND no end date or end date
 * on or after the month's first day. Part-month people are prorated." January
 * 2026 listed only the people employed today: leavers who worked in January
 * were missing, and a starter in August was in it, blocked.
 *
 * Demo people only.
 */
describe('a month pays everyone employed in that month (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;
  const ids: Record<string, string> = {};

  const server = () => app.getHttpServer();
  const hire = async (key: string, startDate: string, status: string, endDate?: string, loginOff = false) => {
    const staff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: `Demo ${key}`, clinicId, active: !loginOff } }),
    );
    ids[key] = staff.id;
    await request(server())
      .post(`/workforce/employees/${staff.id}`)
      .set('Authorization', bearer)
      .send({
        employeeNo: `EM-${key}`,
        position: 'Nurse',
        employmentType: 'PERMANENT',
        employmentStatus: status,
        startDate,
        ...(endDate ? { endDate } : {}),
        dateOfBirth: '1994-04-04',
        bankName: 'Maybank',
        bankAccountNo: '512345678901',
      })
      .expect(201);
    await request(server())
      .post(`/workforce/employees/${staff.id}/statutory-classification`)
      .set('Authorization', bearer)
      .send({
        effectiveFrom: startDate,
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
      .post(`/workforce/employees/${staff.id}/salary`)
      .set('Authorization', bearer)
      .send({ amount: '3100.00', basis: 'MONTHLY', effectiveFrom: startDate, reason: 'Starting salary' })
      .expect(201);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'Employed In Month Tenant' } }));
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    clinicId = (await request(server()).post('/clinics').set('Authorization', bearer).send({ name: 'Employed In Month Clinic' }).expect(201)).body.id;
    await request(server()).post('/workforce/legal-employers').set('Authorization', bearer).send({ name: 'Employed In Month Sdn Bhd' }).expect(201);
    await request(server()).post('/workforce/pay-components/seed').set('Authorization', bearer).expect(201);

    await hire('stays', '2024-01-01', 'ACTIVE');
    // Left on 7 January, login switched off as leavers' are.
    await hire('leftJan7', '2024-01-01', 'RESIGNED', '2026-01-07', true);
    await hire('leftAug25', '2024-01-01', 'RESIGNED', '2026-08-25', true);
    // Left before the month: not January's.
    await hire('leftDec', '2024-01-01', 'RESIGNED', '2025-12-31', true);
    // Starts after the month: not January's at all.
    await hire('startsAug17', '2026-08-17', 'ACTIVE');
    // Resigned with no end date on record: when they left is not known.
    await hire('leftUndated', '2024-01-01', 'RESIGNED');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('works out January for the people employed in January, the 7 January leaver for 7 days', async () => {
    const runId = (await request(server()).post('/workforce/payroll/runs').set('Authorization', bearer).send({ period: '2026-01', clinicId }).expect(201)).body.id;
    await request(server()).patch(`/workforce/payroll/runs/${runId}/calculate`).set('Authorization', bearer).expect(200);

    const lines = await withTenantContext(prisma, tenantId, (tx) =>
      tx.payrollLine.findMany({ where: { payrollRunId: runId }, select: { staffId: true, basicSalary: true } }),
    );
    const paid = new Map(lines.map((line) => [line.staffId, Number(line.basicSalary)]));
    expect([...paid.keys()].sort()).toEqual([ids.stays, ids.leftJan7, ids.leftAug25].sort());
    expect(paid.get(ids.stays)).toBe(3100);
    expect(paid.get(ids.leftAug25)).toBe(3100);
    // Calendar days: 7 of 31.
    expect(paid.get(ids.leftJan7)).toBe(700);

    // Nobody outside January is blocked on the run either.
    const blocked = await withTenantContext(prisma, tenantId, (tx) =>
      tx.payrollException.findMany({ where: { payrollRunId: runId, staffId: { in: [ids.startsAug17, ids.leftDec, ids.leftUndated] } } }),
    );
    expect(blocked).toEqual([]);
  });

  it('lists the same people before the month is worked out, and counts missing months only while employed', async () => {
    const readiness = (
      await request(server()).get('/workforce/payroll/readiness').query({ period: '2026-09', clinicId }).set('Authorization', bearer).expect(200)
    ).body;
    const listed = (readiness.employees as { staffId: string; monthsWithoutPay: string | null }[]).map((row) => row.staffId).sort();
    // September: the 25 August leaver has gone; the 17 August starter is here.
    expect(listed).toEqual([ids.stays, ids.startsAug17].sort());
    const gaps = Object.fromEntries((readiness.employees as { staffId: string; monthsWithoutPay: string | null }[]).map((row) => [row.staffId, row.monthsWithoutPay]));
    // January was worked out but not approved, so it is not on record:
    // January to August for the one who stayed, only August for the starter.
    expect(gaps[ids.stays]).toBe('Jan–Aug');
    expect(gaps[ids.startsAug17]).toBe('Aug');

    const january = (
      await request(server()).get('/workforce/payroll/readiness').query({ period: '2026-01', clinicId }).set('Authorization', bearer).expect(200)
    ).body;
    expect((january.employees as { staffId: string }[]).map((row) => row.staffId).sort()).toEqual([ids.stays, ids.leftJan7, ids.leftAug25].sort());
  });
});
