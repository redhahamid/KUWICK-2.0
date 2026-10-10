import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();

/**
 * A MONTH IN ARREARS (UAT, 10 October 2026).
 *
 * "September's overtime, locum and director's fee go into the October run —
 * counted in October's statutory, labelled 'earned September'. Do not shift
 * them a second month."
 *
 * Overtime set a month in arrears is paid by the run after the month it was
 * worked in, priced on the salary in force when it was worked, and labelled
 * with that month. Switching arrears on pays nothing twice — a day another
 * month's run carries is left out — and switching it off loses nothing: last
 * month's days no run has paid are picked up with this month's. A hand-keyed
 * item a month in arrears is last month's unless the line says otherwise.
 *
 * Every day here is a Tuesday: no rest day and no public holiday to price.
 */
describe('items paid a month in arrears (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;
  let staffId: string;

  const server = () => app.getHttpServer();
  const worked = (date: string, overtimeMinutes: number) =>
    withTenantContext(prisma, tenantId, (tx) =>
      tx.attendanceRecord.create({
        data: {
          tenantId,
          staffId,
          clinicId,
          workDate: new Date(`${date}T00:00:00.000Z`),
          status: 'PRESENT',
          workedMinutes: 450 + overtimeMinutes,
          overtimeMinutes,
          overtimeApproved: true,
        },
      }),
    );
  const workOut = async (period: string) => {
    const created = await request(server()).post('/workforce/payroll/runs').set('Authorization', bearer).send({ period, clinicId }).expect(201);
    await request(server()).patch(`/workforce/payroll/runs/${created.body.id}/calculate`).set('Authorization', bearer).expect(200);
    const line = await withTenantContext(prisma, tenantId, (tx) =>
      tx.payrollLine.findFirstOrThrow({ where: { payrollRunId: created.body.id, staffId }, select: { overtimePay: true } }),
    );
    return Number(line.overtimePay);
  };
  const overtimeOf = async (period: string) =>
    (
      (await request(server()).get(`/workforce/payroll/inputs?period=${period}&staffId=${staffId}`).set('Authorization', bearer).expect(200))
        .body as { componentCode: string; earnedPeriod: string | null; amount: string }[]
    )
      .filter((row) => row.componentCode === 'OVERTIME')
      .map((row) => ({ earned: row.earnedPeriod, amount: Number(row.amount) }));
  const setPayDate = (code: string, body: Record<string, unknown>) =>
    request(server()).patch(`/workforce/pay-components/${code}/pay-date`).set('Authorization', bearer).send(body).expect(200);
  const keyed = async (period: string, componentCode: string, extra: Record<string, unknown> = {}) => {
    await request(server())
      .post('/workforce/payroll/inputs')
      .set('Authorization', bearer)
      .send({ staffId, period, componentCode, amount: '500.00', reason: 'This month', ...extra })
      .expect(201);
    const rows = (await request(server()).get(`/workforce/payroll/inputs?period=${period}&staffId=${staffId}`).set('Authorization', bearer).expect(200))
      .body as { componentCode: string; earnedPeriod: string | null }[];
    return rows.find((row) => row.componentCode === componentCode)!.earnedPeriod;
  };

  let septemberPerHour = 0;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'Arrears Tenant' } }));
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    clinicId = (await request(server()).post('/clinics').set('Authorization', bearer).send({ name: 'Arrears Clinic' }).expect(201)).body.id;
    const legalEmployerId = (await request(server()).post('/workforce/legal-employers').set('Authorization', bearer).send({ name: 'Arrears Sdn Bhd' }).expect(201)).body.id;
    await request(server()).post('/workforce/pay-components/seed').set('Authorization', bearer).expect(201);

    const staff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Demo Nurse', clinicId } }),
    );
    staffId = staff.id;
    await request(server())
      .post(`/workforce/employees/${staffId}`)
      .set('Authorization', bearer)
      .send({ employeeNo: 'AR-1', position: 'Nurse', employmentType: 'PERMANENT', employmentStatus: 'ACTIVE', startDate: '2024-01-01', dateOfBirth: '1994-04-04' })
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
    await request(server()).patch(`/workforce/employees/${staffId}/legal-employer`).set('Authorization', bearer).send({ legalEmployerId }).expect(200);
    await request(server())
      .post(`/workforce/employees/${staffId}/salary`)
      .set('Authorization', bearer)
      .send({ amount: '3000.00', basis: 'MONTHLY', effectiveFrom: '2024-01-01', reason: 'Starting salary' })
      .expect(201);
    // A raise from November: October's overtime must still be paid at October's rate.
    await request(server())
      .post(`/workforce/employees/${staffId}/salary`)
      .set('Authorization', bearer)
      .send({ amount: '3600.00', basis: 'MONTHLY', effectiveFrom: '2026-11-01', reason: 'Annual increment' })
      .expect(201);

    await worked('2026-09-08', 120);
    await worked('2026-10-06', 90);
    await worked('2026-11-10', 60);
    await worked('2026-12-08', 30);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('pays a month’s own overtime in its own run while nothing is in arrears', async () => {
    const overtimePay = await workOut('2026-09');
    const rows = await overtimeOf('2026-09');
    expect(rows).toHaveLength(1);
    expect(rows[0].earned).toBeNull();
    expect(overtimePay).toBe(rows[0].amount);
    septemberPerHour = rows[0].amount / 2;
  });

  it('pays nothing twice when overtime is switched to a month in arrears', async () => {
    await setPayDate('OVERTIME', { payDay: 15, paidInArrears: true });
    // September's day is carried by September's run; October's waits for November.
    expect(await workOut('2026-10')).toBe(0);
    expect(await overtimeOf('2026-10')).toEqual([]);
  });

  it('pays last month’s overtime in the next run, labelled and priced as last month’s', async () => {
    const overtimePay = await workOut('2026-11');
    const rows = await overtimeOf('2026-11');
    expect(rows).toEqual([{ earned: '2026-10-01', amount: overtimePay }]);
    // 1.5 hours at October's RM3,000 rate, not November's RM3,600.
    expect(Math.abs(overtimePay - 1.5 * septemberPerHour)).toBeLessThanOrEqual(0.01);
  });

  it('loses nothing when arrears is switched off: last month’s unpaid days come with this month’s', async () => {
    await setPayDate('OVERTIME', { payDay: 15, paidInArrears: false });
    await workOut('2026-12');
    const rows = await overtimeOf('2026-12');
    expect(rows.map((row) => row.earned).sort()).toEqual(['2026-11-01', null].sort());
  });

  it('keys a hand-entered item a month in arrears as last month’s, unless the line says otherwise', async () => {
    await setPayDate('DIRECTOR_FEE', { payDay: 1, paidInArrears: true });
    await setPayDate('LOCUM_FEE', { payDay: 15, paidInArrears: true });
    expect(await keyed('2026-12', 'DIRECTOR_FEE')).toBe('2026-11-01');
    expect(await keyed('2026-12', 'HOUSECALL')).toBeNull();
    expect(await keyed('2026-12', 'LOCUM_FEE', { earnedPeriod: null })).toBeNull();
  });
});
