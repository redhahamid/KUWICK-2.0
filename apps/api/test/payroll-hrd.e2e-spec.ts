import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();

/**
 * THE HRD LEVY REACHES THE RUN — and only where it truthfully can.
 *
 * The engine (OFFICIAL_SOURCE_VERIFIED, HRD Corp's own guideline) existed and
 * drove nothing: a registered employer's employer cost was short 1% of
 * leviable wages every month. Now: a dated registration class on the employer
 * feeds the calculation; an UNRECORDED class computes nothing and raises one
 * run-level warning — because "not recorded" and "not registered" are
 * different answers and only one of them is worth zero.
 */
describe('HRD levy in the payroll run (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;
  let legalEmployerId: string;
  let staffId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, name: 'HRD Tenant' } }),
    );
    const owner = await createOwnerAndBearer(prisma, tenantId);
    bearer = owner.bearer;

    const clinic = await request(app.getHttpServer())
      .post('/clinics')
      .set('Authorization', bearer)
      .send({ name: 'HRD Clinic' })
      .expect(201);
    clinicId = clinic.body.id;

    const employer = await request(app.getHttpServer())
      .post('/workforce/legal-employers')
      .set('Authorization', bearer)
      .send({ name: 'HRD Employer Sdn Bhd' })
      .expect(201);
    legalEmployerId = employer.body.id;

    await request(app.getHttpServer())
      .post('/workforce/pay-components/seed')
      .set('Authorization', bearer)
      .expect(201);

    const staff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({
        data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Levy Person', clinicId },
      }),
    );
    staffId = staff.id;
    await request(app.getHttpServer())
      .post(`/workforce/employees/${staffId}`)
      .set('Authorization', bearer)
      .send({
        employeeNo: 'H-001',
        position: 'Clinic Assistant',
        employmentType: 'PERMANENT',
        employmentStatus: 'ACTIVE',
        startDate: '2024-01-01',
        dateOfBirth: '1992-04-19',
        bankName: 'Maybank',
        bankAccountNo: '512345678901',
      })
      .expect(201);
    await request(app.getHttpServer())
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
    await request(app.getHttpServer())
      .patch(`/workforce/employees/${staffId}/legal-employer`)
      .set('Authorization', bearer)
      .send({ legalEmployerId })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/workforce/employees/${staffId}/salary`)
      .set('Authorization', bearer)
      .send({ amount: '3000.00', basis: 'MONTHLY', effectiveFrom: '2024-01-01', reason: 'Starting salary' })
      .expect(201);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  async function calculatedRun(period: string) {
    const run = await request(app.getHttpServer())
      .post('/workforce/payroll/runs')
      .set('Authorization', bearer)
      .send({ period, clinicId })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/workforce/payroll/runs/${run.body.id}/calculate`)
      .set('Authorization', bearer)
      .expect(200);
    return run.body.id as string;
  }

  it('computes NO levy and raises one run-level warning while the registration is unrecorded', async () => {
    const runId = await calculatedRun('2026-05');
    const detail = await request(app.getHttpServer())
      .get(`/workforce/payroll/runs/${runId}`)
      .set('Authorization', bearer)
      .expect(200);
    const line = detail.body.lines[0];
    expect(line.hrdLevy).toBeNull();

    // The register says why, on the row and once for the run — not only "not worked out".
    const journey = await request(app.getHttpServer()).get(`/workforce/payroll/runs/${runId}/journey`).set('Authorization', bearer).expect(200);
    expect(journey.body.pay.rows[0].hrdNote).toMatch(/not recorded/);
    expect(journey.body.pay.hrdAdvice).toMatch(/is not recorded/);
    expect(journey.body.pay.hrdAdvice).toContain('Settings, Company and statutory');

    const gate = await request(app.getHttpServer())
      .get(`/workforce/payroll/runs/${runId}/exceptions`)
      .set('Authorization', bearer)
      .expect(200);
    const warning = (gate.body.exceptions as { code: string; severity: string; staffId: string | null }[]).find(
      (row) => row.code === 'HRD_REGISTRATION_UNRECORDED',
    );
    expect(warning).toBeDefined();
    expect(warning!.severity).toBe('WARNING');
    // Run-level: the gap is the employer's, not any employee's.
    expect(warning!.staffId).toBeNull();
    // And it does not block approval on its own.
    expect(gate.body.gate.canApprove).toBe(true);

    /*
     * AN ACKNOWLEDGEMENT SURVIVES WORKING THE MONTH OUT AGAIN when the warning
     * comes back saying the same thing (UAT, 6 October 2026).
     */
    const id = (gate.body.exceptions as { id: string; code: string }[]).find((row) => row.code === 'HRD_REGISTRATION_UNRECORDED')!.id;
    await request(app.getHttpServer())
      .patch(`/workforce/payroll/exceptions/${id}/override`)
      .set('Authorization', bearer)
      .send({ reason: 'Registration in progress with HRD Corp' })
      .expect(200);
    await request(app.getHttpServer()).patch(`/workforce/payroll/runs/${runId}/calculate`).set('Authorization', bearer).expect(200);
    const again = await request(app.getHttpServer()).get(`/workforce/payroll/runs/${runId}/exceptions`).set('Authorization', bearer).expect(200);
    expect((again.body.exceptions as { code: string }[]).find((row) => row.code === 'HRD_REGISTRATION_UNRECORDED')).toMatchObject({
      title: 'HRD Corp registration not recorded',
      overriddenBy: expect.any(String),
      overrideReason: 'Registration in progress with HRD Corp',
    });
  });

  it('levies 1% of leviable wages into employer cost once s.14 registration is recorded', async () => {
    await request(app.getHttpServer())
      .post(`/workforce/legal-employers/${legalEmployerId}/statutory-profile`)
      .set('Authorization', bearer)
      .send({ effectiveFrom: '2024-01-01', hrdRegistration: 'MANDATORY_SECTION_14', reason: 'Registered' })
      .expect(201);

    const runId = await calculatedRun('2026-06');
    const detail = await request(app.getHttpServer())
      .get(`/workforce/payroll/runs/${runId}`)
      .set('Authorization', bearer)
      .expect(200);
    const line = detail.body.lines[0];
    // 1% of RM3,000 basic — no fixed allowances, overtime not in the base.
    expect(Number(line.hrdLevy)).toBe(30);
    // Employer cost carries it; the employee's money does not.
    expect(Number(line.employerCost)).toBe(
      Number(line.grossPay) +
        Number(line.epfEmployer) +
        Number(line.socsoEmployer) +
        Number(line.eisEmployer) +
        30,
    );

    const gate = await request(app.getHttpServer())
      .get(`/workforce/payroll/runs/${runId}/exceptions`)
      .set('Authorization', bearer)
      .expect(200);
    expect(
      (gate.body.exceptions as { code: string }[]).some((row) => row.code === 'HRD_REGISTRATION_UNRECORDED'),
    ).toBe(false);

    // The company page says from when the class applies, and stops listing it as missing.
    const employers = await request(app.getHttpServer()).get('/workforce/legal-employers').set('Authorization', bearer).expect(200);
    const employer = (employers.body as { id: string; hrdEffectiveFrom: string | null; statutoryReadiness: { missing: string[] } }[]).find(
      (row) => row.id === legalEmployerId,
    )!;
    expect(employer.hrdEffectiveFrom).toBe('2024-01-01');
    expect(employer.statutoryReadiness.missing).not.toContain('HRD Corp registration class');
  });

  it('freezes the levy into the approved snapshot and the payslip’s employer contributions', async () => {
    const runId = await calculatedRun('2026-07');
    await request(app.getHttpServer())
      .patch(`/workforce/payroll/runs/${runId}/approve`)
      .set('Authorization', bearer)
      .send({ acknowledgeStatutoryGap: true })
      .expect(200);

    const slip = await request(app.getHttpServer())
      .get(`/workforce/payroll/runs/${runId}/payslips/${staffId}`)
      .set('Authorization', bearer)
      .expect(200);
    const hrdRow = (slip.body.employerContributions as { key: string; amountCents: number }[]).find(
      (row) => row.key === 'HRD',
    );
    expect(hrdRow).toBeDefined();
    expect(hrdRow!.amountCents).toBe(3000);
    expect(slip.body.figures.employerCostCents).toBe(
      slip.body.figures.grossCents + slip.body.figures.employerContributionCents,
    );
  });

  it('blocks the month when the registration class changes part-way through it', async () => {
    await request(app.getHttpServer())
      .post(`/workforce/legal-employers/${legalEmployerId}/statutory-profile`)
      .set('Authorization', bearer)
      .send({ effectiveFrom: '2026-08-15', hrdRegistration: 'NOT_REGISTERED', reason: 'Deregistered mid-month' })
      .expect(201);

    const runId = await calculatedRun('2026-08');
    const gate = await request(app.getHttpServer())
      .get(`/workforce/payroll/runs/${runId}/exceptions`)
      .set('Authorization', bearer)
      .expect(200);
    const blocker = (gate.body.exceptions as { code: string; severity: string }[]).find(
      (row) => row.code === 'HRD_REGISTRATION_CHANGED_MID_PERIOD',
    );
    expect(blocker).toBeDefined();
    expect(blocker!.severity).toBe('BLOCKING');
    expect(gate.body.gate.canApprove).toBe(false);
  });
});
