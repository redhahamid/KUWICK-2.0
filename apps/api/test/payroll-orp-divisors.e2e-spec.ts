import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();

/**
 * HOW A MONTHLY SALARY BECOMES A DAY AND AN HOUR.
 *
 * `PayrollRun.orpOvertimeDays`, `orpUnpaidLeaveDays` and `orpHoursPerDay` have
 * been READ on every run since Stage 1 and were never WRITTEN, so every payroll
 * in the system used the schema defaults 26 / 31 / 7.5 — while the rule set's
 * own `overtimeDays`, `unpaidLeaveDays` and `overtimeHoursPerDay` sat beside
 * them, editable, and applied to nothing. The payroll report printed "Clinic
 * policy, frozen on this run" over a number the clinic had never been asked
 * for.
 *
 * For the clinic that found this the defaults happened to be the right numbers,
 * which is exactly what kept it invisible. The next clinic is the one at risk.
 */
describe('the ordinary-rate divisors reach the run (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;
  let legalEmployerId: string;

  const http = () => request(app.getHttpServer());

  const employ = async (staffId: string, employeeNo: string, salary: string) => {
    await http()
      .post(`/workforce/employees/${staffId}`)
      .set('Authorization', bearer)
      .send({
        employeeNo,
        position: 'Clinic assistant',
        employmentType: 'PERMANENT',
        employmentStatus: 'ACTIVE',
        startDate: '2024-01-01',
      })
      .expect(201);
    await http()
      .patch(`/workforce/employees/${staffId}/legal-employer`)
      .set('Authorization', bearer)
      .send({ legalEmployerId })
      .expect(200);
    await http()
      .post(`/workforce/employees/${staffId}/salary`)
      .set('Authorization', bearer)
      .send({ amount: salary, basis: 'MONTHLY', effectiveFrom: '2024-01-01', reason: 'Starting salary' })
      .expect(201);
  };

  const ruleSet = (body: Record<string, unknown>) =>
    http().post('/workforce/payroll-policies').set('Authorization', bearer).send(body);

  const createRun = (period: string) =>
    http().post('/workforce/payroll/runs').set('Authorization', bearer).send({ period, clinicId });

  beforeEach(async () => {
    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'ORP Tenant' } }));
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    clinicId = (await http().post('/clinics').set('Authorization', bearer).send({ name: 'ORP Clinic' }).expect(201)).body.id;
    legalEmployerId = (
      await http().post('/workforce/legal-employers').set('Authorization', bearer).send({ name: 'ORP Sdn Bhd' }).expect(201)
    ).body.id;

    const clerk = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Kaunter Ujian', clinicId } }),
    );
    await employ(clerk.id, 'O-001', '3000.00');
  });

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

  const divisorsOf = (runId: string) =>
    withTenantContext(prisma, tenantId, (tx) => tx.payrollRun.findUnique({ where: { id: runId } })).then((run) => ({
      overtimeDays: Number(run?.orpOvertimeDays),
      unpaidLeaveDays: Number(run?.orpUnpaidLeaveDays),
      hoursPerDay: Number(run?.orpHoursPerDay),
    }));

  it("freezes the clinic's own answer onto the run instead of the schema's 26 / 31 / 7.5", async () => {
    await ruleSet({ name: 'Everybody', isDefault: true, overtimeDays: 20, unpaidLeaveDays: 30, overtimeHoursPerDay: 8 }).expect(201);

    const runId = (await createRun('2026-08').expect(201)).body.id;

    expect(await divisorsOf(runId)).toEqual({ overtimeDays: 20, unpaidLeaveDays: 30, hoursPerDay: 8 });
  });

  it('leaves the defaults standing where no rule set covers anybody, because there is no clinic answer to freeze', async () => {
    const runId = (await createRun('2026-08').expect(201)).body.id;

    expect(await divisorsOf(runId)).toEqual({ overtimeDays: 26, unpaidLeaveDays: 31, hoursPerDay: 7.5 });
  });

  it('refuses the run where two rule sets disagree, naming both rather than picking one', async () => {
    // A second person, in a different group, on a rule set that answers
    // differently. One run carries one ordinary rate, so half of these people
    // would be priced from a divisor nobody agreed on their behalf.
    const doctor = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.DOCTOR_RESIDENT, fullName: 'Dr Ujian', clinicId } }),
    );
    await employ(doctor.id, 'O-002', '9500.00');

    await ruleSet({ name: 'Everybody', isDefault: true, overtimeDays: 26, unpaidLeaveDays: 31, overtimeHoursPerDay: 7.5 }).expect(201);
    await ruleSet({ name: 'Doctors', workforceCategory: 'DOCTOR', overtimeDays: 22, unpaidLeaveDays: 30, overtimeHoursPerDay: 8 }).expect(201);

    const refused = await createRun('2026-08').expect(400);
    expect(refused.body.message).toContain('Everybody');
    expect(refused.body.message).toContain('Doctors');
    expect(refused.body.message).toContain('one ordinary rate');
  });

  it('allows two rule sets that agree, so the refusal is about the numbers and not about having groups', async () => {
    const doctor = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.DOCTOR_RESIDENT, fullName: 'Dr Sama', clinicId } }),
    );
    await employ(doctor.id, 'O-003', '9500.00');

    // Different overtime PRICING, same ordinary-rate divisors. That is the
    // common shape — doctors on a session rate, everybody on the same
    // arithmetic for what a day is worth — and it must not be refused.
    await ruleSet({ name: 'Everybody', isDefault: true, overtimeDays: 24, unpaidLeaveDays: 30, overtimeHoursPerDay: 8 }).expect(201);
    await ruleSet({
      name: 'Doctors',
      workforceCategory: 'DOCTOR',
      overtimeMode: 'CLINIC_RATE',
      clinicPublicHolidayShift: '500.00',
      overtimeDays: 24,
      unpaidLeaveDays: 30,
      overtimeHoursPerDay: 8,
    }).expect(201);

    const runId = (await createRun('2026-08').expect(201)).body.id;
    expect(await divisorsOf(runId)).toEqual({ overtimeDays: 24, unpaidLeaveDays: 30, hoursPerDay: 8 });
  });
});
