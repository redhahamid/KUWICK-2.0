import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();

/**
 * A CLINIC THAT PAYS MORE THAN THE ACT, AND CAN SAY SO.
 *
 * A rule set had exactly two answers for what extra hours are worth: the
 * Employment Act's fixed 1.5× / 2× / 3×, or fixed ringgit amounts. Neither
 * expresses "we pay overtime at 2×", which is what a clinic paying above the
 * Act actually does — so such a clinic had to choose between a multiplier it
 * had outgrown and a flat amount that stops tracking the salary the day
 * anybody gets a rise.
 *
 * The Act stays the floor, in the direction the Act itself sets: ss.60A(3)(a),
 * 60(3)(c) and 60D(3)(aa) say "not less than", so a multiplier ABOVE is the
 * clinic's to choose and one BELOW is refused where it is typed, the way a
 * 30-day ordinary-rate divisor is.
 *
 * One clerk on RM3,120 in August 2026, so the arithmetic is checkable by hand:
 * a day is 3120 / 26 = RM120 and an hour is 120 / 8 = RM15.
 */
describe('the clinic’s own overtime multipliers (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;
  let legalEmployerId: string;
  let clerkId: string;

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
        dateOfBirth: '1990-05-05',
        bankName: 'Maybank',
        bankAccountNo: '512345678901',
      })
      .expect(201);
    // Without a classification in force for the month the run excludes the
    // person entirely, and there is no overtime line to check a multiplier
    // against.
    await http()
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

  const worked = (staffId: string, date: string, workedMinutes: number, overtimeMinutes: number) =>
    withTenantContext(prisma, tenantId, (tx) =>
      tx.attendanceRecord.create({
        data: {
          tenantId,
          staffId,
          clinicId,
          workDate: new Date(`${date}T00:00:00.000Z`),
          status: 'PRESENT',
          workedMinutes,
          overtimeMinutes,
          overtimeApproved: overtimeMinutes > 0,
        },
      }),
    );

  const overtimeInput = async (staffId: string) => {
    const res = await http()
      .get(`/workforce/payroll/inputs?period=2026-08&staffId=${staffId}`)
      .set('Authorization', bearer)
      .expect(200);
    return (res.body as { label: string | null; amount: string }[]).find((row) => row.label === 'Overtime');
  };

  const calculate = async () => {
    const runId = (
      await http().post('/workforce/payroll/runs').set('Authorization', bearer).send({ period: '2026-08', clinicId }).expect(201)
    ).body.id;
    await http().patch(`/workforce/payroll/runs/${runId}/calculate`).set('Authorization', bearer).expect(200);
    return runId;
  };

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
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'Multiplier Tenant' } }));
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    clinicId = (await http().post('/clinics').set('Authorization', bearer).send({ name: 'Multiplier Clinic' }).expect(201)).body.id;
    legalEmployerId = (
      await http().post('/workforce/legal-employers').set('Authorization', bearer).send({ name: 'Multiplier Sdn Bhd' }).expect(201)
    ).body.id;
    // The run reads the pay-component catalogue to put overtime on a line.
    await http().post('/workforce/pay-components/seed').set('Authorization', bearer).expect(201);

    const clerk = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Kaunter Ujian', clinicId } }),
    );
    clerkId = clerk.id;
    await employ(clerkId, 'M-001', '3120.00');
  });

  it('refuses a multiplier below the Act, naming the section and both figures', async () => {
    const refused = await ruleSet({
      name: 'Too little',
      isDefault: true,
      overtimeHoursPerDay: 8,
      overtimeMultiplier: 1.25,
    }).expect(400);
    expect(JSON.stringify(refused.body.message)).toContain('1.5');
    expect(JSON.stringify(refused.body.message)).toContain('60A(3)(a)');
  });

  it('refuses a public-holiday multiplier of 2, which is below the Act’s 3 however ordinary it looks', async () => {
    // The Act's public-holiday floor is on the HOURS beyond normal hours, and
    // it is 3×. Two days' wages for the day itself is a different figure under
    // s.60D(3)(a)(i) and is not a multiplier anybody sets.
    const refused = await ruleSet({
      name: 'Holidays at two',
      isDefault: true,
      overtimeHoursPerDay: 8,
      publicHolidayMultiplier: 2,
    }).expect(400);
    expect(JSON.stringify(refused.body.message)).toContain('60D(3)(aa)');
  });

  it('accepts a multiplier above the Act and pays the overtime at it', async () => {
    await ruleSet({ name: 'Two times', isDefault: true, overtimeHoursPerDay: 8, overtimeMultiplier: 2 }).expect(201);
    // Two approved hours. The Act's 1.5× is RM45; the clinic's 2× is RM60.
    await worked(clerkId, '2026-08-12', 600, 120);
    await calculate();
    expect((await overtimeInput(clerkId))?.amount).toBe('60.00');
  });

  it('leaves the Act’s figure in force where the clinic set nothing', async () => {
    await ruleSet({ name: 'On the Act', isDefault: true, overtimeHoursPerDay: 8 }).expect(201);
    await worked(clerkId, '2026-08-12', 600, 120);
    await calculate();
    // The migration adds three nullable columns and must move no figure: two
    // hours at RM15 × 1.5.
    expect((await overtimeInput(clerkId))?.amount).toBe('45.00');
  });

  it('says on the rule set list whose multipliers are in force', async () => {
    await ruleSet({ name: 'Two times', isDefault: true, overtimeHoursPerDay: 8, overtimeMultiplier: 2 }).expect(201);
    await ruleSet({ name: 'Doctors', workforceCategory: 'DOCTOR', overtimeHoursPerDay: 8 }).expect(201);

    const list = await http().get('/workforce/payroll-policies').set('Authorization', bearer).expect(200);
    const rows = list.body.policies as { name: string; multipliers: Record<string, { used: number; act: number; set: boolean }> }[];

    const raised = rows.find((row) => row.name === 'Two times')!;
    expect(raised.multipliers.overtime).toEqual({ used: 2, act: 1.5, set: true });
    // Raising one leaves the other two on the Act, so a clinic need not restate
    // what it did not change.
    expect(raised.multipliers.restDay).toEqual({ used: 2, act: 2, set: false });
    expect(raised.multipliers.publicHoliday).toEqual({ used: 3, act: 3, set: false });

    const untouched = rows.find((row) => row.name === 'Doctors')!;
    expect(untouched.multipliers.overtime).toEqual({ used: 1.5, act: 1.5, set: false });
  });

  it('clears a raised multiplier back to the Act when the box is emptied', async () => {
    const created = await ruleSet({ name: 'Two times', isDefault: true, overtimeHoursPerDay: 8, overtimeMultiplier: 2 }).expect(201);
    await ruleSet({ id: created.body.id, name: 'Two times', isDefault: true, overtimeHoursPerDay: 8, overtimeMultiplier: null }).expect(
      201,
    );

    const list = await http().get('/workforce/payroll-policies').set('Authorization', bearer).expect(200);
    const row = (list.body.policies as { name: string; multipliers: { overtime: { used: number; set: boolean } } }[]).find(
      (entry) => entry.name === 'Two times',
    )!;
    // Back on the Act's, and stored as "on the Act's" rather than as a typed
    // 1.5 that would stop following the Act if Parliament ever moved it.
    expect(row.multipliers.overtime).toEqual({ used: 1.5, act: 1.5, set: false });
  });
});
