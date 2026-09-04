import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { bearerFor, createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();

/**
 * STATUTORY OUTPUTS ARE PREPARED, RECONCILED — AND NEVER SUBMITTED.
 *
 * The figures are the approved snapshot's, per scheme, beside the schedule
 * edition that produced them. "Submitted" exists only as a person's recorded
 * statement — date and portal reference — and nothing else in the payload can
 * ever read that way.
 */
describe('Payroll statutory outputs (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;
  let legalEmployerId: string;
  let staffId: string;
  let runId: string;

  const PERIOD = '2026-07';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, name: 'Outputs Tenant' } }),
    );
    const owner = await createOwnerAndBearer(prisma, tenantId);
    bearer = owner.bearer;

    const clinic = await request(app.getHttpServer())
      .post('/clinics')
      .set('Authorization', bearer)
      .send({ name: 'Outputs Clinic' })
      .expect(201);
    clinicId = clinic.body.id;

    const employer = await request(app.getHttpServer())
      .post('/workforce/legal-employers')
      .set('Authorization', bearer)
      .send({
        name: 'Outputs Employer Sdn Bhd',
        epfEmployerNo: 'EPF-E-77',
        socsoEmployerNo: 'SOC-E-77',
        lhdnEmployerNo: 'E-770077',
      })
      .expect(201);
    legalEmployerId = employer.body.id;
    await request(app.getHttpServer())
      .post(`/workforce/legal-employers/${legalEmployerId}/statutory-profile`)
      .set('Authorization', bearer)
      .send({ effectiveFrom: '2024-01-01', hrdRegistration: 'MANDATORY_SECTION_14', reason: 'Registered' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/workforce/pay-components/seed')
      .set('Authorization', bearer)
      .expect(201);

    const staff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({
        data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Filed Person', clinicId },
      }),
    );
    staffId = staff.id;
    await request(app.getHttpServer())
      .post(`/workforce/employees/${staffId}`)
      .set('Authorization', bearer)
      .send({
        employeeNo: 'F-001',
        position: 'Clinic Assistant',
        employmentType: 'PERMANENT',
        employmentStatus: 'ACTIVE',
        startDate: '2024-01-01',
        dateOfBirth: '1992-04-19',
        epfNumber: 'EPF-M-123',
        socsoNumber: 'SOC-M-456',
        taxNumber: 'SG 1234567890',
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
        lindungParticipation: 'VOLUNTARY_OPTED_IN',
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
      .send({ amount: '3200.00', basis: 'MONTHLY', effectiveFrom: '2024-01-01', reason: 'Starting salary' })
      .expect(201);

    const run = await request(app.getHttpServer())
      .post('/workforce/payroll/runs')
      .set('Authorization', bearer)
      .send({ period: PERIOD, clinicId })
      .expect(201);
    runId = run.body.id;
    await request(app.getHttpServer())
      .patch(`/workforce/payroll/runs/${runId}/calculate`)
      .set('Authorization', bearer)
      .expect(200);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('refuses outputs for an unapproved run', async () => {
    await request(app.getHttpServer())
      .get(`/workforce/payroll/runs/${runId}/statutory-outputs`)
      .set('Authorization', bearer)
      .expect(409);
  });

  it('prepares every scheme from the approved snapshot, reconciled and stamped', async () => {
    await request(app.getHttpServer())
      .patch(`/workforce/payroll/runs/${runId}/approve`)
      .set('Authorization', bearer)
      .send({ acknowledgeStatutoryGap: true })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get(`/workforce/payroll/runs/${runId}/statutory-outputs`)
      .set('Authorization', bearer)
      .expect(200);

    expect(res.body.notASubmission).toMatch(/Kuwick submits nothing/);
    expect(res.body.employerIdentity.epfEmployerNo).toBe('EPF-E-77');

    const schemes = res.body.schemes as {
      scheme: string;
      rows: { membershipNo: string | null; employeeCents: number | null; employerCents: number | null }[];
      employeeTotalCents: number;
      employerTotalCents: number;
      schedule: { scheduleId: string | null } | null;
      submission: unknown;
    }[];
    expect(schemes.map((row) => row.scheme)).toEqual(['EPF', 'SOCSO', 'EIS', 'LINDUNG', 'PCB', 'HRD']);

    const epf = schemes.find((row) => row.scheme === 'EPF')!;
    expect(epf.rows[0].membershipNo).toBe('EPF-M-123');
    expect(epf.rows[0].employeeCents).toBeGreaterThan(0);
    expect(epf.employeeTotalCents).toBe(epf.rows[0].employeeCents);
    // The edition that produced the figures rides with them.
    expect(epf.schedule?.scheduleId).toBeTruthy();
    expect(epf.submission).toBeNull();

    const lindung = schemes.find((row) => row.scheme === 'LINDUNG')!;
    expect(lindung.rows[0].employeeCents).toBeGreaterThan(0);
    expect(lindung.rows[0].employerCents).toBe(0);

    const hrd = schemes.find((row) => row.scheme === 'HRD')!;
    expect(hrd.employerTotalCents).toBe(3200); // 1% of RM3,200
  });

  it('downloads a listing that names itself a non-submission', async () => {
    const res = await request(app.getHttpServer())
      .get(`/workforce/payroll/runs/${runId}/statutory-outputs/epf/listing`)
      .set('Authorization', bearer)
      .expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('NOT a submission file');
    expect(res.text).toContain('Filed Person');
    expect(res.text).toContain('EPF-M-123');
  });

  it('lets a human record the actual filing — once — and only then reads submitted', async () => {
    await request(app.getHttpServer())
      .post(`/workforce/payroll/runs/${runId}/statutory-outputs/epf/record-submission`)
      .set('Authorization', bearer)
      .send({ submittedDate: '2026-08-10', reference: 'KWSP-ACK-991122' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/workforce/payroll/runs/${runId}/statutory-outputs`)
      .set('Authorization', bearer)
      .expect(200);
    const epf = (res.body.schemes as { scheme: string; submission: { reference: string } | null }[]).find(
      (row) => row.scheme === 'EPF',
    )!;
    expect(epf.submission?.reference).toBe('KWSP-ACK-991122');

    // A second claim is refused: corrections happen at the authority.
    await request(app.getHttpServer())
      .post(`/workforce/payroll/runs/${runId}/statutory-outputs/epf/record-submission`)
      .set('Authorization', bearer)
      .send({ submittedDate: '2026-08-11', reference: 'KWSP-ACK-991123' })
      .expect(409);

    // And a reference is not optional — a claim without one is not a record.
    await request(app.getHttpServer())
      .post(`/workforce/payroll/runs/${runId}/statutory-outputs/socso/record-submission`)
      .set('Authorization', bearer)
      .send({ submittedDate: '2026-08-10', reference: '' })
      .expect(409);
  });

  it('keeps the outputs surface behind the statutory-export permission', async () => {
    const outsider = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({
        data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'No Statutory', clinicId },
      }),
    );
    const outsiderBearer = bearerFor(tenantId, outsider.id, Role.FRONT_DESK_CLINICAL_STAFF);
    await request(app.getHttpServer())
      .get(`/workforce/payroll/runs/${runId}/statutory-outputs`)
      .set('Authorization', outsiderBearer)
      .expect(403);
    await request(app.getHttpServer())
      .post(`/workforce/payroll/runs/${runId}/statutory-outputs/epf/record-submission`)
      .set('Authorization', outsiderBearer)
      .send({ submittedDate: '2026-08-10', reference: 'X' })
      .expect(403);
  });
});
