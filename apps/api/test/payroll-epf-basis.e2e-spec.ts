import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { bearerFor, createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();

/**
 * OWNER-CONTROLLED EPF CONTRIBUTION BASIS — the end-to-end story.
 *
 * One employee, two months, every rule the product requirement names: the
 * selection drives the calculation; the assessment never bends to it; a
 * discrepancy is loud, audited, blocking and non-overridable; the correction
 * road exists and leaves a truthful trail; approved history is untouchable;
 * a reopen re-opens the question; and the whole thing stays confidential.
 */
describe('EPF contribution basis (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;
  let employerId: string;
  let bettyId: string;
  let carlId: string;

  const server = () => app.getHttpServer();
  const JUNE = '2026-06';
  const JULY = '2026-07';

  const calc = (runId: string) =>
    request(server()).patch(`/workforce/payroll/runs/${runId}/calculate`).set('Authorization', bearer).expect(200);
  const lineOf = async (runId: string, staffId: string) =>
    withTenantContext(prisma, tenantId, (tx) => tx.payrollLine.findFirst({ where: { payrollRunId: runId, staffId } }));
  const exceptionsOf = async (runId: string) => {
    const res = await request(server())
      .get(`/workforce/payroll/runs/${runId}/exceptions`)
      .set('Authorization', bearer)
      .expect(200);
    return res.body.exceptions as {
      id: string;
      code: string;
      severity: string;
      staffName: string | null;
      cause: string;
      overridable: boolean;
    }[];
  };
  const recordBasis = (body: Record<string, unknown>) =>
    request(server()).post(`/workforce/employees/${bettyId}/contribution-basis`).set('Authorization', bearer).send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, name: 'EPF Basis Tenant' } }),
    );
    const owner = await createOwnerAndBearer(prisma, tenantId);
    bearer = owner.bearer;

    const clinic = await request(server()).post('/clinics').set('Authorization', bearer).send({ name: 'Basis Branch' }).expect(201);
    clinicId = clinic.body.id;
    const employer = await request(server())
      .post('/workforce/legal-employers')
      .set('Authorization', bearer)
      .send({ name: 'Basis Sdn Bhd' })
      .expect(201);
    employerId = employer.body.id;
    await request(server()).post('/workforce/pay-components/seed').set('Authorization', bearer).expect(201);

    const staff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Basis Betty', clinicId } }),
    );
    bettyId = staff.id;
    await request(server())
      .post(`/workforce/employees/${bettyId}`)
      .set('Authorization', bearer)
      .send({
        employeeNo: 'BB-1',
        position: 'Clinic Assistant',
        employmentType: 'PERMANENT',
        employmentStatus: 'ACTIVE',
        startDate: '2024-01-01',
        dateOfBirth: '1993-03-03',
      })
      .expect(201);
    await request(server())
      .post(`/workforce/employees/${bettyId}/statutory-classification`)
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
      .patch(`/workforce/employees/${bettyId}/legal-employer`)
      .set('Authorization', bearer)
      .send({ legalEmployerId: employerId })
      .expect(200);
    await request(server())
      .post(`/workforce/employees/${bettyId}/salary`)
      .set('Authorization', bearer)
      .send({ amount: '3000.00', basis: 'MONTHLY', effectiveFrom: '2024-01-01', reason: 'Starting salary' })
      .expect(201);

    /*
     * The additional income the story turns on. Commission is EPF wages by
     * s.2; the locum-session fee is an EMPLOYEE's extra remuneration priced
     * outside EPF wages by the catalogue's own treatment — the same word
     * "locum" as a CONTRACTOR engagement below, deliberately, because the two
     * must never collapse into one treatment.
     */
    for (const period of [JUNE, JULY]) {
      await request(server())
        .post('/workforce/payroll/inputs')
        .set('Authorization', bearer)
        .send({ staffId: bettyId, period, componentCode: 'COMMISSION', amount: '500.00', reason: 'Sales commission' })
        .expect(201);
      await request(server())
        .post('/workforce/payroll/inputs')
        .set('Authorization', bearer)
        .send({ staffId: bettyId, period, componentCode: 'LOCUM_FEE', amount: '200.00', reason: 'Extra session' })
        .expect(201);
    }

    // A genuine CONTRACTOR named like the income row. Never on a payroll line.
    const carl = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Locum Carl', clinicId } }),
    );
    carlId = carl.id;
    await request(server())
      .post(`/workforce/employees/${carlId}`)
      .set('Authorization', bearer)
      .send({
        employeeNo: 'LC-1',
        position: 'Locum Doctor',
        employmentType: 'CONTRACT',
        employmentStatus: 'ACTIVE',
        startDate: '2024-01-01',
        dateOfBirth: '1988-08-08',
      })
      .expect(201);
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.employeeProfile.updateMany({ where: { staffId: carlId }, data: { engagement: 'CONTRACTOR' } }),
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  let juneRunId: string;
  let julyRunId: string;

  it('with no selection recorded, the month contributes on the full assessment and approves clean', async () => {
    const run = await request(server())
      .post('/workforce/payroll/runs')
      .set('Authorization', bearer)
      .send({ period: JUNE, clinicId })
      .expect(201);
    juneRunId = run.body.id;
    await calc(juneRunId);
    const line = await lineOf(juneRunId, bettyId);
    // 3000 basic + 500 commission are EPF wages; the RM200 locum session is
    // outside them by the Act — and inside gross. Total earnings ≠ EPF basis,
    // by the assessment alone.
    expect(Number(line?.epfEmployee)).toBe(385);
    expect(Number(line?.grossPay)).toBe(3700);
    await request(server()).patch(`/workforce/payroll/runs/${juneRunId}/approve`).set('Authorization', bearer).expect(200);
  });

  it('a contractor engaged for locum work never becomes a payroll line, whatever the income row is called', async () => {
    const carlLine = await lineOf(juneRunId, carlId);
    expect(carlLine).toBeNull();
  });

  it('a basis cannot be recorded into an approved month — what was contributed on is settled', async () => {
    const refused = await recordBasis({
      scheme: 'EPF',
      mode: 'BASIC_ONLY',
      effectiveFrom: '2026-06-01',
      reason: 'Owner wants EPF on basic only',
    });
    expect(refused.status).toBe(409);
    expect(refused.body.message).toMatch(/approved payroll run/i);
  });

  it('recording from an open month works, demands a reason, audits the decision, and endorses nothing', async () => {
    const noReason = await recordBasis({ scheme: 'EPF', mode: 'BASIC_ONLY', effectiveFrom: '2026-07-01' });
    expect(noReason.status).toBe(400);

    const saved = await recordBasis({
      scheme: 'EPF',
      mode: 'BASIC_ONLY',
      effectiveFrom: '2026-07-01',
      reason: 'Owner wants EPF on basic only',
    });
    expect(saved.status).toBe(201);
    expect(saved.body.notEndorsed).toMatch(/statutory discrepancy/i);

    const audit = await withTenantContext(prisma, tenantId, (tx) =>
      tx.auditLog.findFirst({ where: { action: 'employeeContributionBasis.recorded' }, orderBy: { createdAt: 'desc' } }),
    );
    expect(audit).not.toBeNull();
    expect(audit?.entityType).toBe('EmployeeContributionBasis');
    expect((audit?.after as { mode?: string })?.mode).toBe('BASIC_ONLY');
  });

  it('the June snapshot is untouched by the July selection', async () => {
    const line = await lineOf(juneRunId, bettyId);
    expect(Number(line?.epfEmployee)).toBe(385);
    const snap = await request(server())
      .get(`/workforce/payroll/runs/${juneRunId}/snapshots/1`)
      .set('Authorization', bearer)
      .expect(200);
    expect(snap.body.verification.verdict).toBe('VERIFIED');
    const betty = snap.body.payload.employees.find((row: { staffId: string }) => row.staffId === bettyId);
    expect(betty.statutory.epfEmployeeCents).toBe(38500);
    expect(betty.payslip.epfBasis).toBeUndefined();
  });

  it('a discrepancy month computes ON the selection, names what it leaves out, and can be neither approved nor overridden', async () => {
    const run = await request(server())
      .post('/workforce/payroll/runs')
      .set('Authorization', bearer)
      .send({ period: JULY, clinicId })
      .expect(201);
    julyRunId = run.body.id;
    await calc(julyRunId);

    // The selection drives the figures: EPF on basic alone…
    const line = await lineOf(julyRunId, bettyId);
    expect(Number(line?.epfEmployee)).toBe(330);
    // …while total earnings and the other schemes stand where the assessment
    // puts them. The EPF basis and total earnings reconcile SEPARATELY.
    expect(Number(line?.grossPay)).toBe(3700);
    const breakdown = line?.breakdown as {
      bases: { epfCents: number; socsoCents: number };
      epfBasis: { assessedEpfCents: number; appliedEpfCents: number; excluded: { code: string }[] };
    };
    expect(breakdown.bases.epfCents).toBe(300000);
    // SOCSO keeps ITS OWN assessment: basic + commission (the locum fee is
    // outside SOCSO wages by the catalogue) — and no EPF selection moves it.
    expect(breakdown.bases.socsoCents).toBe(350000);
    expect(breakdown.epfBasis.assessedEpfCents).toBe(350000);
    expect(breakdown.epfBasis.appliedEpfCents).toBe(300000);
    expect(breakdown.epfBasis.excluded.map((row) => row.code)).toEqual(['COMMISSION']);

    // Loud, named, blocking — and not overridable, because s.43 is not a
    // preference.
    const rows = await exceptionsOf(julyRunId);
    const discrepancy = rows.find((row) => row.code === 'EPF_BASIS_DISCREPANCY');
    expect(discrepancy).toBeDefined();
    expect(discrepancy?.severity).toBe('BLOCKING');
    expect(discrepancy?.staffName).toBe('Basis Betty');
    expect(discrepancy?.cause).toContain('Commission');
    expect(discrepancy?.cause).toContain('500.00');
    expect(discrepancy?.overridable).toBe(false);

    const approve = await request(server())
      .patch(`/workforce/payroll/runs/${julyRunId}/approve`)
      .set('Authorization', bearer)
      .send({});
    expect(approve.status).toBe(400);

    const override = await request(server())
      .patch(`/workforce/payroll/exceptions/${discrepancy?.id}/override`)
      .set('Authorization', bearer)
      .send({ reason: 'Owner insists' });
    expect(override.status).toBe(400);
    expect(override.body.message).toMatch(/cannot be overridden/i);
  });

  it('a mid-month change blocks the month rather than letting Kuwick pick a half', async () => {
    await recordBasis({
      scheme: 'EPF',
      mode: 'BASIC_PLUS_SELECTED',
      includedComponentCodes: ['COMMISSION'],
      effectiveFrom: '2026-07-15',
      reason: 'Correcting the basis mid-month',
    }).expect(201);
    await calc(julyRunId);
    const rows = await exceptionsOf(julyRunId);
    expect(rows.some((row) => row.code === 'EPF_BASIS_CHANGED_MID_PERIOD')).toBe(true);
  });

  it('recording from the intended day replaces the recorded story from that day on — the road back', async () => {
    await recordBasis({
      scheme: 'EPF',
      mode: 'BASIC_PLUS_SELECTED',
      includedComponentCodes: ['COMMISSION'],
      effectiveFrom: '2026-07-01',
      reason: 'EPF on basic and commission, from the month it was meant for',
    }).expect(201);

    // Both the experiment and the mid-month detour survive in history as
    // superseded rows — never in force, never deleted.
    const history = await request(server())
      .get(`/workforce/employees/${bettyId}/contribution-basis`)
      .set('Authorization', bearer)
      .expect(200);
    const superseded = history.body.versions.filter((row: { superseded: boolean }) => row.superseded);
    expect(superseded.length).toBe(2);
    const current = history.body.versions.find((row: { current: boolean }) => row.current);
    expect(current.mode).toBe('BASIC_PLUS_SELECTED');
    expect(current.includedComponentCodes).toEqual(['COMMISSION']);
    // The editor's vocabulary rides along, with the assessment stated.
    const commission = history.body.components.find((c: { code: string }) => c.code === 'COMMISSION');
    const overtime = history.body.components.find((c: { code: string }) => c.code === 'OVERTIME');
    expect(commission.epfLiable).toBe(true);
    expect(overtime.epfLiable).toBe(false);
  });

  it('a compliant selection clears the month and approves — the locum fee stays outside by the Act, not by the tick', async () => {
    await calc(julyRunId);
    const rows = await exceptionsOf(julyRunId);
    expect(rows.some((row) => row.code.startsWith('EPF_BASIS'))).toBe(false);

    const line = await lineOf(julyRunId, bettyId);
    expect(Number(line?.epfEmployee)).toBe(385); // basic + commission
    expect(Number(line?.grossPay)).toBe(3700); // locum fee still earned
    const breakdown = line?.breakdown as {
      epfBasis: { mode: string; appliedEpfCents: number; excluded: unknown[] };
    };
    expect(breakdown.epfBasis.mode).toBe('BASIC_PLUS_SELECTED');
    expect(breakdown.epfBasis.appliedEpfCents).toBe(350000);
    expect(breakdown.epfBasis.excluded).toEqual([]);

    await request(server()).patch(`/workforce/payroll/runs/${julyRunId}/approve`).set('Authorization', bearer).expect(200);

    // The approved snapshot preserves the whole story: mode, codes, assessed
    // beside applied, and an empty discrepancy list — verified independently.
    const snap = await request(server())
      .get(`/workforce/payroll/runs/${julyRunId}/snapshots/1`)
      .set('Authorization', bearer)
      .expect(200);
    expect(snap.body.verification.verdict).toBe('VERIFIED');
    const betty = snap.body.payload.employees.find((row: { staffId: string }) => row.staffId === bettyId);
    expect(betty.payslip.epfBasis.mode).toBe('BASIC_PLUS_SELECTED');
    expect(betty.payslip.epfBasis.includedCodes).toContain('COMMISSION');
    expect(betty.payslip.epfBasis.assessedEpfCents).toBe(350000);
    expect(betty.payslip.epfBasis.appliedEpfCents).toBe(350000);
    expect(betty.payslip.epfBasis.excluded).toEqual([]);
  });

  it('a reopen invalidates the approval and reopens the question; revision 2 freezes the new answer while revision 1 stands', async () => {
    await request(server())
      .patch(`/workforce/payroll/runs/${julyRunId}/reopen`)
      .set('Authorization', bearer)
      .send({ reason: 'Correcting the EPF basis' })
      .expect(200);

    // The month is unapproved again, so the basis may change again.
    await recordBasis({
      scheme: 'EPF',
      mode: 'ALL_APPLICABLE',
      effectiveFrom: '2026-07-01',
      reason: 'Back to the statutory assessment after review',
    }).expect(201);
    await calc(julyRunId);
    const blocking = (await exceptionsOf(julyRunId)).filter((row) => row.severity === 'BLOCKING');
    expect(blocking).toEqual([]);
    await request(server()).patch(`/workforce/payroll/runs/${julyRunId}/approve`).set('Authorization', bearer).expect(200);

    const v2 = await request(server())
      .get(`/workforce/payroll/runs/${julyRunId}/snapshots/2`)
      .set('Authorization', bearer)
      .expect(200);
    const bettyV2 = v2.body.payload.employees.find((row: { staffId: string }) => row.staffId === bettyId);
    expect(bettyV2.payslip.epfBasis.mode).toBe('ALL_APPLICABLE');

    const v1 = await request(server())
      .get(`/workforce/payroll/runs/${julyRunId}/snapshots/1`)
      .set('Authorization', bearer)
      .expect(200);
    const bettyV1 = v1.body.payload.employees.find((row: { staffId: string }) => row.staffId === bettyId);
    expect(bettyV1.payslip.epfBasis.mode).toBe('BASIC_PLUS_SELECTED');
  });

  it('pay confidentiality holds: an HR clerk can neither read nor select a contribution basis', async () => {
    const clerkStaff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.HR_STAFF, fullName: 'Clerk Chris', clinicId } }),
    );
    const clerk = bearerFor(tenantId, clerkStaff.id, Role.HR_STAFF);

    const read = await request(server())
      .get(`/workforce/employees/${bettyId}/contribution-basis`)
      .set('Authorization', clerk);
    expect(read.status).toBe(403);

    const write = await request(server())
      .post(`/workforce/employees/${bettyId}/contribution-basis`)
      .set('Authorization', clerk)
      .send({ scheme: 'EPF', mode: 'BASIC_ONLY', effectiveFrom: '2026-09-01', reason: 'Should be refused' });
    expect(write.status).toBe(403);
  });
});
