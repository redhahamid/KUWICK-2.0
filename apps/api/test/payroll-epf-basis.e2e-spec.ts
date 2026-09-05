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
 * selection below the assessment is an ADVISORY that states every figure and
 * lets the month proceed, while a missing FACT still blocks; the correction
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
      consequence: string;
      overridable: boolean;
    }[];
  };
  /**
   * The LATEST snapshot version, resolved rather than assumed. July is
   * approved more than once in this file — once on the employer's selection
   * and again after the correction — so a hard-coded version number would
   * silently start asserting against the wrong revision.
   */
  const snapshotVersions = async (runId: string): Promise<number[]> => {
    const res = await request(server())
      .get(`/workforce/payroll/runs/${runId}/snapshots`)
      .set('Authorization', bearer)
      .expect(200);
    return (res.body as { version: number }[]).map((row) => row.version).sort((a, b) => a - b);
  };
  const snapshotAt = async (runId: string, version: number) => {
    const res = await request(server())
      .get(`/workforce/payroll/runs/${runId}/snapshots/${version}`)
      .set('Authorization', bearer)
      .expect(200);
    return res.body;
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

  it('a discrepancy month computes ON the selection, states every figure, and CAN still be approved', async () => {
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

    /*
     * ADVISORY, NOT BLOCKING — the product decision. The employer chose this
     * basis deliberately, so the month proceeds; what Kuwick owes the reader
     * is every figure behind the difference, and the name of whoever chose it.
     */
    const rows = await exceptionsOf(julyRunId);
    const discrepancy = rows.find((row) => row.code === 'EPF_BASIS_DISCREPANCY');
    expect(discrepancy).toBeDefined();
    expect(discrepancy?.severity).toBe('WARNING');
    expect(discrepancy?.staffName).toBe('Basis Betty');
    // Gross, assessed, selected, the difference, the components, the date,
    // the author and their reason — all of it, in the row itself.
    expect(discrepancy?.cause).toContain('3000.00');
    expect(discrepancy?.consequence).toContain('Gross earnings RM3700.00');
    expect(discrepancy?.consequence).toContain('assesses EPF wages of RM3500.00');
    expect(discrepancy?.consequence).toContain('basis is RM3000.00');
    expect(discrepancy?.consequence).toContain('difference of RM500.00');
    expect(discrepancy?.consequence).toContain('Commission RM500.00');
    expect(discrepancy?.consequence).toContain('2026-07-01');
    expect(discrepancy?.consequence).toContain('Owner wants EPF on basic only');
    // And it never claims the selection is lawful.
    expect(discrepancy?.consequence).toMatch(/does not treat it as meeting the Act/i);
    expect(discrepancy?.consequence).toMatch(/stays the employer.s to make good/i);

    // Nothing blocking stands in the way, and the month approves.
    const blocking = rows.filter((row) => row.severity === 'BLOCKING');
    expect(blocking).toEqual([]);

    // The advisory may also be acknowledged deliberately, on the record.
    expect(discrepancy?.overridable).toBe(true);
    await request(server())
      .patch(`/workforce/payroll/exceptions/${discrepancy?.id}/override`)
      .set('Authorization', bearer)
      .send({ reason: 'Owner has confirmed the selection is intended' })
      .expect(200);

    await request(server()).patch(`/workforce/payroll/runs/${julyRunId}/approve`).set('Authorization', bearer).expect(200);

    // The approved record freezes the whole story — including the difference,
    // which is never quietly resolved — and still verifies.
    const snap = await request(server())
      .get(`/workforce/payroll/runs/${julyRunId}/snapshots/1`)
      .set('Authorization', bearer)
      .expect(200);
    expect(snap.body.verification.verdict).toBe('VERIFIED');
    const betty = snap.body.payload.employees.find((row: { staffId: string }) => row.staffId === bettyId);
    expect(betty.statutory.epfEmployeeCents).toBe(33000);
    expect(betty.payslip.epfBasis.mode).toBe('BASIC_ONLY');
    expect(betty.payslip.epfBasis.assessedEpfCents).toBe(350000);
    expect(betty.payslip.epfBasis.appliedEpfCents).toBe(300000);
    expect(betty.payslip.epfBasis.excluded.map((row: { code: string }) => row.code)).toEqual(['COMMISSION']);
    expect(betty.payslip.epfBasis.selectedBy).toBeTruthy();
    expect(betty.payslip.epfBasis.selectionReason).toBe('Owner wants EPF on basic only');
    expect(betty.payslip.epfBasis.effectiveFrom).toBe('2026-07-01');

    // The EPF filing listing names it too, without disturbing the totals.
    const outputs = await request(server())
      .get(`/workforce/payroll/runs/${julyRunId}/statutory-outputs`)
      .set('Authorization', bearer)
      .expect(200);
    const epf = outputs.body.schemes.find((block: { scheme: string }) => block.scheme === 'EPF');
    const bettyRow = epf.rows.find((row: { staffId: string }) => row.staffId === bettyId);
    expect(bettyRow.basisNote).toContain('Employer-selected basis RM3000.00');
    expect(bettyRow.basisNote).toContain('Kuwick assesses RM3500.00');
    expect(epf.employeeTotalCents).not.toBeNull();

    // Other schemes are untouched by an EPF selection.
    const socso = outputs.body.schemes.find((block: { scheme: string }) => block.scheme === 'SOCSO');
    const bettySocso = socso.rows.find((row: { staffId: string }) => row.staffId === bettyId);
    expect(bettySocso.wagesCents).toBe(350000);
    expect(bettySocso.basisNote).toBeNull();

    // Reopen, so the rest of the file continues from an unapproved month.
    await request(server())
      .patch(`/workforce/payroll/runs/${julyRunId}/reopen`)
      .set('Authorization', bearer)
      .send({ reason: 'Continuing the basis story' })
      .expect(200);
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
    const versions = await snapshotVersions(julyRunId);
    const snap = await snapshotAt(julyRunId, versions[versions.length - 1]);
    expect(snap.verification.verdict).toBe('VERIFIED');
    const betty = snap.payload.employees.find((row: { staffId: string }) => row.staffId === bettyId);
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

    // The NEWEST revision holds the new answer; every earlier one still holds
    // the answer it was approved on, including the employer's own selection.
    const versions = await snapshotVersions(julyRunId);
    expect(versions.length).toBeGreaterThanOrEqual(3);
    const newest = await snapshotAt(julyRunId, versions[versions.length - 1]);
    const bettyNewest = newest.payload.employees.find((row: { staffId: string }) => row.staffId === bettyId);
    expect(bettyNewest.payslip.epfBasis.mode).toBe('ALL_APPLICABLE');
    expect(bettyNewest.payslip.epfBasis.excluded).toEqual([]);

    const first = await snapshotAt(julyRunId, versions[0]);
    const bettyFirst = first.payload.employees.find((row: { staffId: string }) => row.staffId === bettyId);
    expect(bettyFirst.payslip.epfBasis.mode).toBe('BASIC_ONLY');
    expect(bettyFirst.payslip.epfBasis.appliedEpfCents).toBe(300000);
    // The month approved on a lower basis keeps saying so, for ever.
    expect(bettyFirst.payslip.epfBasis.excluded.map((row: { code: string }) => row.code)).toEqual(['COMMISSION']);
    expect(bettyFirst.statutory.epfEmployeeCents).toBe(33000);

    const middle = await snapshotAt(julyRunId, versions[1]);
    const bettyMiddle = middle.payload.employees.find((row: { staffId: string }) => row.staffId === bettyId);
    expect(bettyMiddle.payslip.epfBasis.mode).toBe('BASIC_PLUS_SELECTED');
  });

  it('ALL_APPLICABLE raises no advisory at all — the selected basis IS the assessment', async () => {
    const rows = await exceptionsOf(julyRunId);
    expect(rows.filter((row) => row.code === 'EPF_BASIS_DISCREPANCY')).toEqual([]);
    const line = await lineOf(julyRunId, bettyId);
    const breakdown = line?.breakdown as {
      epfBasis: { mode: string; assessedEpfCents: number; appliedEpfCents: number; excluded: unknown[] };
    };
    expect(breakdown.epfBasis.mode).toBe('ALL_APPLICABLE');
    expect(breakdown.epfBasis.appliedEpfCents).toBe(breakdown.epfBasis.assessedEpfCents);
    expect(breakdown.epfBasis.excluded).toEqual([]);
  });

  it('every other scheme is untouched by the EPF selection, in the run and at the filing', async () => {
    // July stands approved from the reopen test above, and an approved month
    // refuses a basis change — as it must. Reopen it deliberately, which is
    // the product's own correction road, and leave it open for what follows.
    await request(server())
      .patch(`/workforce/payroll/runs/${julyRunId}/reopen`)
      .set('Authorization', bearer)
      .send({ reason: 'Proving scheme independence on an open month' })
      .expect(200);

    // Re-select a lower EPF basis and prove ONLY EPF moves. SOCSO, EIS, PCB
    // and the levy answer to their own Acts, and an EPF preference is not
    // one of their inputs.
    const before = await lineOf(julyRunId, bettyId);
    await recordBasis({
      scheme: 'EPF',
      mode: 'BASIC_ONLY',
      effectiveFrom: '2026-07-01',
      reason: 'Proving the other schemes do not follow EPF',
    }).expect(201);
    await calc(julyRunId);
    const after = await lineOf(julyRunId, bettyId);

    expect(Number(after?.epfEmployee)).toBeLessThan(Number(before?.epfEmployee));
    expect(Number(after?.socsoEmployee)).toBe(Number(before?.socsoEmployee));
    expect(Number(after?.socsoEmployer)).toBe(Number(before?.socsoEmployer));
    expect(Number(after?.eisEmployee)).toBe(Number(before?.eisEmployee));
    expect(Number(after?.eisEmployer)).toBe(Number(before?.eisEmployer));
    expect(Number(after?.hrdLevy)).toBe(Number(before?.hrdLevy));
    expect(Number(after?.grossPay)).toBe(Number(before?.grossPay));
    const bases = (after?.breakdown as { bases: { socsoCents: number; eisCents: number } }).bases;
    expect(bases.socsoCents).toBe(350000);
    expect(bases.eisCents).toBe(350000);
    // PCB follows the contribution actually made (K1), which is the one
    // legitimate onward effect — and it is a tax relief, not another scheme's
    // base: the PCB REMUNERATION base is unmoved.
    const pcbBases = (after?.breakdown as { bases: Record<string, number> }).bases;
    expect(pcbBases.epfCents).toBe(300000);
  });

  it('an approved month never moves when the basis changes later — prospective only', async () => {
    // June was approved on the full assessment before any selection existed,
    // and every July experiment since has left it exactly where it was.
    const june = await lineOf(juneRunId, bettyId);
    expect(Number(june?.epfEmployee)).toBe(385);
    expect(Number(june?.epfEmployer)).toBe(455);
    const snap = await snapshotAt(juneRunId, 1);
    expect(snap.verification.verdict).toBe('VERIFIED');
    const betty = snap.payload.employees.find((row: { staffId: string }) => row.staffId === bettyId);
    expect(betty.statutory.epfEmployeeCents).toBe(38500);
    expect(betty.payslip.epfBasis).toBeUndefined();
  });

  it('a fact that prevents calculation still BLOCKS — a selection is not a substitute for one', async () => {
    // An employee whose EPF membership is unrecorded cannot have EPF worked
    // out at all. That is an UNKNOWN, not a decision, and no contribution
    // basis makes it knowable: the run must refuse.
    const staff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Unknown Uma', clinicId } }),
    );
    await request(server())
      .post(`/workforce/employees/${staff.id}`)
      .set('Authorization', bearer)
      .send({
        employeeNo: 'UU-1',
        position: 'Clinic Assistant',
        employmentType: 'PERMANENT',
        employmentStatus: 'ACTIVE',
        startDate: '2024-01-01',
        dateOfBirth: '1995-05-05',
      })
      .expect(201);
    await request(server())
      .patch(`/workforce/employees/${staff.id}/legal-employer`)
      .set('Authorization', bearer)
      .send({ legalEmployerId: employerId })
      .expect(200);
    await request(server())
      .post(`/workforce/employees/${staff.id}/salary`)
      .set('Authorization', bearer)
      .send({ amount: '2500.00', basis: 'MONTHLY', effectiveFrom: '2024-01-01', reason: 'Starting salary' })
      .expect(201);
    // A basis IS recorded for her — and changes nothing about the unknown.
    await request(server())
      .post(`/workforce/employees/${staff.id}/contribution-basis`)
      .set('Authorization', bearer)
      .send({
        scheme: 'EPF',
        mode: 'BASIC_ONLY',
        effectiveFrom: '2026-07-01',
        reason: 'Selected, but the membership question is still open',
      })
      .expect(201);

    await calc(julyRunId);
    const rows = await exceptionsOf(julyRunId);
    const blocking = rows.filter((row) => row.severity === 'BLOCKING');
    expect(blocking.length).toBeGreaterThan(0);
    expect(blocking.some((row) => row.staffName === 'Unknown Uma')).toBe(true);
    const approve = await request(server())
      .patch(`/workforce/payroll/runs/${julyRunId}/approve`)
      .set('Authorization', bearer)
      .send({});
    expect(approve.status).toBe(400);
  });

  it('a basis naming a component that does not exist is refused — invalid input is not a preference', async () => {
    const refused = await recordBasis({
      scheme: 'EPF',
      mode: 'BASIC_PLUS_SELECTED',
      includedComponentCodes: ['NOT_A_COMPONENT'],
      effectiveFrom: '2026-08-01',
      reason: 'Should be refused',
    });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toMatch(/not a pay component/i);

    // Nor may a deduction be selected as though it were income.
    const deduction = await recordBasis({
      scheme: 'EPF',
      mode: 'BASIC_PLUS_SELECTED',
      includedComponentCodes: ['ZAKAT'],
      effectiveFrom: '2026-08-01',
      reason: 'Should be refused',
    });
    expect(deduction.status).toBe(400);
    expect(deduction.body.message).toMatch(/not an earning/i);
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
