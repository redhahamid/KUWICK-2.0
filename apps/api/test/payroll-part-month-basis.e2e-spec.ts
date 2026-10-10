import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();

/**
 * HOW A PART MONTH IS PAID, per rule set (UAT, 10 October 2026).
 *
 * Calendar days are s.18A of the Employment Act and the default: 1,800 × 11/31
 * = 638.71 for somebody who joins on 21 October. A clinic may choose working
 * days instead, counted from each person's own working week; then the same
 * joiner on a six-day week with Sundays off is paid 1,800 × 10/27 = 666.67.
 * Working days can pay less than the Act — a leaver whose last day is a
 * Sunday — and the run says so, by name and amount. Somebody with no fixed
 * week on record is paid by calendar days, and the run says why.
 */
describe('a part month by calendar or working days (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;
  let legalEmployerId: string;
  let ruleSetId: string;
  const staff: Record<string, string> = {};

  const http = () => request(app.getHttpServer());

  const employ = async (name: string, employeeNo: string, profile: Record<string, unknown> & { startDate: string }) => {
    const row = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: name, clinicId } }),
    );
    staff[name] = row.id;
    await http()
      .post(`/workforce/employees/${row.id}`)
      .set('Authorization', bearer)
      .send({ employeeNo, position: 'Clinic assistant', employmentType: 'PERMANENT', dateOfBirth: '1995-03-03', ...profile })
      .expect(201);
    await http()
      .post(`/workforce/employees/${row.id}/statutory-classification`)
      .set('Authorization', bearer)
      .send({
        effectiveFrom: profile.startDate,
        epfMembership: 'MALAYSIAN_CITIZEN',
        taxResidence: 'RESIDENT',
        pcbCategory: 'CATEGORY_1',
        qualifyingChildren: 0,
        restDayOfWeek: 0,
        lindungParticipation: 'NOT_PARTICIPATING',
        reason: 'Recorded at hire',
      })
      .expect(201);
    await http().patch(`/workforce/employees/${row.id}/legal-employer`).set('Authorization', bearer).send({ legalEmployerId }).expect(200);
    await http()
      .post(`/workforce/employees/${row.id}/salary`)
      .set('Authorization', bearer)
      .send({ amount: '1800.00', basis: 'MONTHLY', effectiveFrom: profile.startDate, reason: 'Starting salary' })
      .expect(201);
  };

  const ruleSet = (body: Record<string, unknown>) => http().post('/workforce/payroll-policies').set('Authorization', bearer).send(body);

  const workOut = async () => {
    const runs = (await http().get('/workforce/payroll/runs').set('Authorization', bearer).expect(200)).body;
    const list = (Array.isArray(runs) ? runs : (runs.items ?? runs.runs)) as { id: string; period: string }[];
    const existing = list.find((run) => run.period.startsWith('2026-10'));
    const runId = existing?.id ?? (await http().post('/workforce/payroll/runs').set('Authorization', bearer).send({ period: '2026-10', clinicId }).expect(201)).body.id;
    const calculated = await http().patch(`/workforce/payroll/runs/${runId}/calculate`).set('Authorization', bearer);
    expect([calculated.status, calculated.status === 200 ? '' : calculated.body.message]).toEqual([200, '']);
    const lines = await withTenantContext(prisma, tenantId, (tx) =>
      tx.payrollLine.findMany({ where: { payrollRunId: runId }, select: { staffId: true, basicSalary: true } }),
    );
    const exceptions = (await http().get(`/workforce/payroll/runs/${runId}/exceptions`).set('Authorization', bearer).expect(200)).body
      .exceptions as { code: string; staffId: string | null; cause: string; consequence: string }[];
    const basic = (name: string) => Number(lines.find((line) => line.staffId === staff[name])?.basicSalary);
    const raised = (name: string, code: string) => exceptions.filter((row) => row.staffId === staff[name] && row.code === code);
    return { basic, raised };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'Part Month Tenant' } }));
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    clinicId = (await http().post('/clinics').set('Authorization', bearer).send({ name: 'Part Month Clinic' }).expect(201)).body.id;
    legalEmployerId = (await http().post('/workforce/legal-employers').set('Authorization', bearer).send({ name: 'Part Month Sdn Bhd' }).expect(201)).body.id;
    await http().post('/workforce/pay-components/seed').set('Authorization', bearer).expect(201);
    ruleSetId = (await ruleSet({ name: 'Everybody', isDefault: true }).expect(201)).body.id;

    await employ('Demo Joiner', 'PM-1', { employmentStatus: 'ACTIVE', startDate: '2026-10-21', workDaysPerWeek: 6 });
    await employ('Demo Leaver', 'PM-2', { employmentStatus: 'NOTICE', startDate: '2024-01-01', endDate: '2026-10-04', workDaysPerWeek: 6 });
    await employ('Demo No Week', 'PM-3', { employmentStatus: 'ACTIVE', startDate: '2026-10-21' });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('starts every rule set on calendar days, and pays a part month by s.18A', async () => {
    const listed = (await http().get('/workforce/payroll-policies').set('Authorization', bearer).expect(200)).body;
    const rows = (Array.isArray(listed) ? listed : listed.policies ?? listed.items) as { id: string; partMonthBasis: string }[];
    expect(rows.find((row) => row.id === ruleSetId)?.partMonthBasis).toBe('CALENDAR_DAYS');

    const month = await workOut();
    expect(month.basic('Demo Joiner')).toBe(638.71);
    expect(month.basic('Demo Leaver')).toBe(232.26);
    expect(month.raised('Demo Joiner', 'PART_MONTH')[0].cause).toBe('Paid for 11 of 31 days: they started on 2026-10-21.');
    expect(month.raised('Demo Leaver', 'PART_MONTH_BELOW_STATUTORY')).toEqual([]);
  });

  it('pays by working days when the clinic chooses them, and says who that pays below the Act', async () => {
    await ruleSet({ id: ruleSetId, name: 'Everybody', isDefault: true, partMonthBasis: 'WORKING_DAYS' }).expect(201);

    const month = await workOut();
    // Six-day week, Sundays off: 10 of October's 27 working days.
    expect(month.basic('Demo Joiner')).toBe(666.67);
    const [joined] = month.raised('Demo Joiner', 'PART_MONTH');
    expect(joined.cause).toBe('Paid for 10 of 27 working days: they started on 2026-10-21.');
    expect(joined.consequence).toMatch(/working days, as their rule set says/);
    expect(month.raised('Demo Joiner', 'PART_MONTH_BELOW_STATUTORY')).toEqual([]);

    // Left on Sunday the 4th: three working days of 27, where s.18A pays four of 31.
    expect(month.basic('Demo Leaver')).toBe(200);
    const [below] = month.raised('Demo Leaver', 'PART_MONTH_BELOW_STATUTORY');
    expect(below.cause).toBe(
      'The "Everybody" rule set pays this part month by working days: 200.00, where s.18A\'s calendar days pay 232.26, 32.26 more.',
    );

    // No working week on record: calendar days, and why.
    expect(month.basic('Demo No Week')).toBe(638.71);
    expect(month.raised('Demo No Week', 'PART_MONTH')[0].cause).toMatch(/Paid for 11 of 31 days.*no fixed working week to count from/);
  });

  it('offers no fixed-day month', async () => {
    await ruleSet({ id: ruleSetId, name: 'Everybody', isDefault: true, partMonthBasis: 'FIXED_DAYS' }).expect(400);
  });
});
