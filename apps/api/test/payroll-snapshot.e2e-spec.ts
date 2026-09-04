import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

/**
 * WHAT A CLINIC APPROVED, AND WHETHER IT STILL SAYS SO.
 *
 * The audited competitor recalculates live until approval, freezes on approval,
 * and on reopen re-derives from CURRENT master data holding no snapshot anybody
 * can inspect — its own dialog admits the figures "could result in different
 * amounts". "What exactly did we approve in January?" then has no answer.
 *
 * Kuwick's snapshot did freeze the FIGURES, but almost nothing that produced
 * them: no statutory schedules, so the hash did not cover which EPF Third
 * Schedule the contributions came out of; no employee classification, so which
 * Part applied was unanswerable; no component treatment beyond a version
 * number read from whatever was active TODAY; no approvals; and none of the
 * blockers somebody overrode to get there.
 *
 * These tests assert the record is complete, that it checks out, and — the one
 * that matters most — that changing master data afterwards moves nothing in it.
 */
describe('the approved payroll snapshot (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;
  let legalEmployerId: string;
  const server = () => app.getHttpServer();

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

  const PERIOD = '2026-08';

  /** A clinic's own component, EPF-liable to begin with. */
  const SITE_ALLOWANCE = {
    code: 'SITE_ALLOWANCE',
    name: 'Site allowance',
    type: 'ADDITION' as const,
    category: 'ALLOWANCE' as const,
    includeIn: 'GROSS_AND_NET' as const,
    epfLiable: true,
    socsoLiable: true,
    eisLiable: true,
    pcbLiable: true,
    includeInOrpBase: false,
  };

  beforeEach(async () => {
    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, name: 'Snapshot Tenant' } }),
    );
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    const clinic = await request(server())
      .post('/clinics')
      .set('Authorization', bearer)
      .send({ name: 'Branch A' })
      .expect(201);
    clinicId = clinic.body.id;
    const employer = await request(server())
      .post('/workforce/legal-employers')
      .set('Authorization', bearer)
      .send({ name: `Snapshot Employer ${randomId().slice(0, 8)}` })
      .expect(201);
    legalEmployerId = employer.body.id;
    await request(server()).post('/workforce/pay-components/seed').set('Authorization', bearer).expect(201);
    // A CLINIC-DEFINED component, so its treatment can be changed later. The
    // seeded ones are system presets: enableable, never redefinable, because a
    // clinic that can retype the EPF liability of basic pay has a payroll
    // nobody can reason about.
    await request(server()).post('/workforce/pay-components').set('Authorization', bearer).send(SITE_ALLOWANCE).expect(201);
  });

  async function employee(name: string, salary: string) {
    const staff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: name, clinicId } }),
    );
    await request(server())
      .post(`/workforce/employees/${staff.id}`)
      .set('Authorization', bearer)
      .send({
        employeeNo: `E-${Math.floor(Math.random() * 1000000)}`,
        position: 'Clinic Assistant',
        employmentStatus: 'ACTIVE',
        startDate: '2024-01-01',
        dateOfBirth: '1990-06-15',
      })
      .expect(201);
    await request(server())
      .post(`/workforce/employees/${staff.id}/statutory-classification`)
      .set('Authorization', bearer)
      .send({
        effectiveFrom: '2020-01-01',
        epfMembership: 'MALAYSIAN_CITIZEN',
        lindungParticipation: 'NOT_PARTICIPATING',
        restDayOfWeek: 0,
        pcbApplicable: false,
        reason: 'Recorded at hire',
      })
      .expect(201);
    await request(server())
      .patch(`/workforce/employees/${staff.id}/legal-employer`)
      .set('Authorization', bearer)
      .send({ legalEmployerId })
      .expect(200);
    await request(server())
      .post(`/workforce/employees/${staff.id}/salary`)
      .set('Authorization', bearer)
      .send({ amount: salary, basis: 'MONTHLY', effectiveFrom: '2024-01-01', reason: 'Starting salary' })
      .expect(201);
    return staff.id;
  }

  /** A calculated, approved run over one employee. */
  async function approvedRun(): Promise<{ runId: string; staffId: string }> {
    const staffId = await employee('Nurul Aina', '3000.00');
    const run = await request(server())
      .post('/workforce/payroll/runs')
      .set('Authorization', bearer)
      .send({ period: PERIOD, clinicId })
      .expect(201);
    await request(server())
      .patch(`/workforce/payroll/runs/${run.body.id}/calculate`)
      .set('Authorization', bearer)
      .expect(200);
    await request(server())
      .patch(`/workforce/payroll/runs/${run.body.id}/approve`)
      .set('Authorization', bearer)
      .send({})
      .expect(200);
    return { runId: run.body.id, staffId };
  }

  const snapshotOf = async (runId: string, version = 1) =>
    (
      await request(server())
        .get(`/workforce/payroll/runs/${runId}/snapshots/${version}`)
        .set('Authorization', bearer)
        .expect(200)
    ).body;

  // -------------------------------------------------------------------------
  it('records the statutory schedules it was calculated against, with their content hashes', async () => {
    const { runId } = await approvedRun();
    const snapshot = await snapshotOf(runId);

    const statutory = snapshot.payload.statutory;
    expect(statutory).not.toBeNull();
    // The period end, not today. A September run re-read in December must not
    // acquire December's schedules.
    expect(statutory.resolvedAt.slice(0, 10)).toBe('2026-09-01');

    const epf = statutory.schedules.find((s: { scheme: string }) => s.scheme === 'EPF');
    expect(epf.scheduleId).toBe('EPF_THIRD_SCHEDULE_2025_10');
    // The strongest state the register defines: reproduced against the
    // authority's own published test vectors, not merely transcribed.
    expect(epf.verification).toBe('OFFICIAL_TEST_VECTOR_VERIFIED');
    // The hash is what makes the record hold: a version string can be edited
    // to say anything, a hash over the band arrays cannot.
    expect(epf.contentHash).toMatch(/^[0-9a-f]{8,}$/);
    expect(epf.document.length).toBeGreaterThan(5);

    // LINDUNG had not commenced in August 2026, and that is NOT a missing
    // schedule. Conflating the two makes an honest run look broken.
    const lindung = statutory.schedules.find((s: { scheme: string }) => s.scheme === 'LINDUNG');
    expect(lindung.notYetInForce).toBe(false);
    expect(lindung.scheduleId).toBe('LINDUNG_SKBBK_PHASE_1_2026_06');
  });

  it('records the statutory standing each payslip was computed on', async () => {
    const { runId, staffId } = await approvedRun();
    const snapshot = await snapshotOf(runId);

    const line = snapshot.payload.employees.find((e: { staffId: string }) => e.staffId === staffId);
    expect(line.classification).not.toBeNull();
    expect(line.classification.epfMembership).toBe('MALAYSIAN_CITIZEN');
    expect(line.classification.lindungParticipation).toBe('NOT_PARTICIPATING');
    expect(line.classification.restDayOfWeek).toBe(0);
    expect(line.classification.effectiveFrom).toBe('2020-01-01');
  });

  it('records each component TREATMENT, not just a version number', async () => {
    const { runId } = await approvedRun();
    const snapshot = await snapshotOf(runId);

    const basic = snapshot.payload.components.find((c: { code: string }) => c.code === 'BASIC');
    expect(basic.liability.epfLiable).toBe(true);
    expect(basic.liability.includeInOrpBase).toBe(true);
    // Every treatment carries how well it is evidenced. A catalogue seeded is
    // not a catalogue checked.
    expect(basic.verification).toBeTruthy();

    // Mileage reimburses a cost; it is not wages under any of the three Acts.
    const mileage = snapshot.payload.components.find((c: { code: string }) => c.code === 'MILEAGE');
    expect(mileage.liability.epfLiable).toBe(false);
    expect(mileage.liability.socsoLiable).toBe(false);
  });

  it('records who approved it, and what they approved it over', async () => {
    const { runId } = await approvedRun();
    const snapshot = await snapshotOf(runId);

    expect(snapshot.payload.approvals).toHaveLength(1);
    expect(snapshot.payload.approvals[0].sequence).toBe(1);
    expect(snapshot.payload.approvals[0].mode).toBeTruthy();
    expect(snapshot.payload.approvals[0].name.length).toBeGreaterThan(0);
    // Present even when empty: an approval is only meaningful beside the
    // exceptions it was given over.
    expect(Array.isArray(snapshot.payload.exceptions)).toBe(true);
  });

  it('verifies against itself on every read, rather than storing a verdict', async () => {
    const { runId } = await approvedRun();
    const snapshot = await snapshotOf(runId);
    expect(snapshot.verification.verdict).toBe('VERIFIED');
    expect(snapshot.verification.hashMatches).toBe(true);
    expect(snapshot.verification.computedHash).toBe(snapshot.hash);
    expect(snapshot.verification.violations).toEqual([]);

    // The list says the same thing, so no screen has to guess.
    const list = await request(server())
      .get(`/workforce/payroll/runs/${runId}/snapshots`)
      .set('Authorization', bearer)
      .expect(200);
    expect(list.body[0].verdict).toBe('VERIFIED');
  });

  /*
   * THE ONE THAT MATTERS.
   *
   * "Later master-data or statutory changes must never silently reprice an
   * approved historical payroll." Every lever that could move a figure is
   * pulled after approval, and the record must not shift under any of them.
   */
  it('does not move when master data changes after approval', async () => {
    const { runId, staffId } = await approvedRun();
    const before = await snapshotOf(runId);

    // 1. A salary rise dated into the approved month is REFUSED outright.
    await request(server())
      .post(`/workforce/employees/${staffId}/salary`)
      .set('Authorization', bearer)
      .send({ amount: '5000.00', basis: 'MONTHLY', effectiveFrom: '2026-08-01', reason: 'Backdated rise' })
      .expect(409);

    // 2. A classification change into the approved month, likewise.
    await request(server())
      .post(`/workforce/employees/${staffId}/statutory-classification`)
      .set('Authorization', bearer)
      .send({ effectiveFrom: '2026-08-01', epfMembership: 'PERMANENT_RESIDENT' })
      .expect(409);

    // 3. Changes from a LATER date are allowed — and change nothing here.
    await request(server())
      .post(`/workforce/employees/${staffId}/salary`)
      .set('Authorization', bearer)
      .send({ amount: '5000.00', basis: 'MONTHLY', effectiveFrom: '2026-10-01', reason: 'October rise' })
      .expect(201);
    await request(server())
      .post(`/workforce/employees/${staffId}/statutory-classification`)
      .set('Authorization', bearer)
      .send({ effectiveFrom: '2026-10-01', epfMembership: 'PERMANENT_RESIDENT' })
      .expect(201);

    // 4. THE COMPONENT CATALOGUE. Making an allowance EPF-exempt from October
    //    is a treatment change of the largest possible kind, and August must
    //    not feel it. The old snapshot recorded only a code and a version
    //    number, so this was exactly the change it could not describe.
    await request(server())
      .post('/workforce/pay-components')
      .set('Authorization', bearer)
      .send({ ...SITE_ALLOWANCE, epfLiable: false, effectiveFrom: '2026-10-01', reason: 'Reclassified from October' })
      .expect(201);

    const after = await snapshotOf(runId);
    expect(after.hash).toBe(before.hash);
    expect(after.verification.verdict).toBe('VERIFIED');
    expect(JSON.stringify(after.payload)).toBe(JSON.stringify(before.payload));

    const allowance = after.payload.components.find((c: { code: string }) => c.code === 'SITE_ALLOWANCE');
    expect(allowance.liability.epfLiable).toBe(true);
    expect(allowance.version).toBe(1);
    const line = after.payload.employees.find((e: { staffId: string }) => e.staffId === staffId);
    expect(line.classification.epfMembership).toBe('MALAYSIAN_CITIZEN');
    expect(line.salaryAmountCents).toBe(300000);
  });

  it('refuses to approve a run whose record would not reconcile with itself', async () => {
    const staffId = await employee('Tampered Figure', '3000.00');
    const run = await request(server())
      .post('/workforce/payroll/runs')
      .set('Authorization', bearer)
      .send({ period: PERIOD, clinicId })
      .expect(201);
    await request(server())
      .patch(`/workforce/payroll/runs/${run.body.id}/calculate`)
      .set('Authorization', bearer)
      .expect(200);

    // What a direct database write looks like. The run is still CALCULATED, so
    // the lock trigger permits it; the invariants ran at calculation, before
    // this. Without a check at approval, this figure would be frozen and
    // hashed, and the permanent record of an approved payroll would be one
    // that could never be reconciled to anything.
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.payrollLine.updateMany({
        where: { payrollRunId: run.body.id, staffId },
        data: { netPay: '9999.00' },
      }),
    );

    const refused = await request(server())
      .patch(`/workforce/payroll/runs/${run.body.id}/approve`)
      .set('Authorization', bearer)
      .send({})
      .expect(409);
    expect(refused.body.message).toMatch(/would not reconcile with itself/);

    // And the run is still not approved — the refusal is not cosmetic.
    const detail = await request(server())
      .get(`/workforce/payroll/runs/${run.body.id}`)
      .set('Authorization', bearer)
      .expect(200);
    expect(detail.body.status).toBe('CALCULATED');
    expect(
      (await request(server()).get(`/workforce/payroll/runs/${run.body.id}/snapshots`).set('Authorization', bearer))
        .body,
    ).toHaveLength(0);
  });

  it('adds a version on re-approval and never replaces one', async () => {
    const { runId, staffId } = await approvedRun();
    const first = await snapshotOf(runId, 1);

    await request(server())
      .patch(`/workforce/payroll/runs/${runId}/reopen`)
      .set('Authorization', bearer)
      .send({ reason: 'Correcting an allowance that was keyed late' })
      .expect(200);

    // A change dated into the period is possible now the month is no longer
    // approved — which is the whole point of reopening deliberately.
    await request(server())
      .post(`/workforce/employees/${staffId}/salary`)
      .set('Authorization', bearer)
      .send({ amount: '3200.00', basis: 'MONTHLY', effectiveFrom: '2026-08-01', reason: 'Corrected rate' })
      .expect(201);
    await request(server())
      .patch(`/workforce/payroll/runs/${runId}/calculate`)
      .set('Authorization', bearer)
      .expect(200);
    await request(server())
      .patch(`/workforce/payroll/runs/${runId}/approve`)
      .set('Authorization', bearer)
      .send({})
      .expect(200);

    // VERSION 1 IS UNTOUCHED. The history reads as a sequence of things that
    // were true, not as one mutable present.
    const stillFirst = await snapshotOf(runId, 1);
    expect(stillFirst.hash).toBe(first.hash);
    expect(stillFirst.payload.employees[0].salaryAmountCents).toBe(300000);

    const second = await snapshotOf(runId, 2);
    expect(second.hash).not.toBe(first.hash);
    expect(second.payload.employees[0].salaryAmountCents).toBe(320000);
    expect(second.verification.verdict).toBe('VERIFIED');

    const list = await request(server())
      .get(`/workforce/payroll/runs/${runId}/snapshots`)
      .set('Authorization', bearer)
      .expect(200);
    expect(list.body.map((s: { version: number }) => s.version)).toEqual([2, 1]);
  });

  it('refuses to update or delete a snapshot at the database, not merely in the service', async () => {
    const { runId } = await approvedRun();
    const row = await withTenantContext(prisma, tenantId, (tx) =>
      tx.payrollSnapshot.findFirstOrThrow({ where: { payrollRunId: runId } }),
    );

    await expect(
      withTenantContext(prisma, tenantId, (tx) =>
        tx.payrollSnapshot.update({ where: { id: row.id }, data: { hash: 'rewritten' } }),
      ),
    ).rejects.toThrow();

    await expect(
      withTenantContext(prisma, tenantId, (tx) => tx.payrollSnapshot.delete({ where: { id: row.id } })),
    ).rejects.toThrow();
  });

  it('scopes a snapshot to the employees the run paid, not to everybody in the month', async () => {
    // Payroll inputs were pulled by PERIOD alone, so a snapshot carried money
    // keyed for somebody the run never paid — at another branch, in another
    // run, under another employing company.
    const other = await request(server())
      .post('/clinics')
      .set('Authorization', bearer)
      .send({ name: 'Branch B' })
      .expect(201);
    const outsiderStaff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({
        data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Branch B Person', clinicId: other.body.id },
      }),
    );
    await request(server())
      .post(`/workforce/employees/${outsiderStaff.id}`)
      .set('Authorization', bearer)
      .send({ position: 'Clinic Assistant', employmentStatus: 'ACTIVE', startDate: '2024-01-01', dateOfBirth: '1990-06-15' })
      .expect(201);
    await request(server())
      .post('/workforce/payroll/inputs')
      .set('Authorization', bearer)
      .send({
        staffId: outsiderStaff.id,
        period: `${PERIOD}-01`,
        componentCode: 'ALLOWANCE',
        amount: '150.00',
        reason: 'Branch B allowance for the same month',
      })
      .expect(201);

    const { runId, staffId } = await approvedRun();
    const snapshot = await snapshotOf(runId);

    const staffIds = snapshot.payload.employees.map((e: { staffId: string }) => e.staffId);
    expect(staffIds).toEqual([staffId]);
    // The other branch's input is NOT in this record.
    const everyInput = snapshot.payload.employees.flatMap((e: { inputs: unknown[] }) => e.inputs);
    expect(everyInput.every((i: { componentCode: string }) => i.componentCode !== 'ALLOWANCE')).toBe(true);
  });
});

describe('a pay component treatment change is a dated version (e2e)', () => {
  /*
   * `catalogueFor` resolves the component table BY PERIOD, and the upsert
   * overwrote the row in place. So marking an allowance EPF-exempt today
   * changed what every unapproved period computed — the same defect the salary
   * and statutory-classification tables were built to remove, in the third
   * place it could reach a payslip.
   */
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  const server = () => app.getHttpServer();

  const COMPONENT = {
    code: 'SITE_ALLOWANCE',
    name: 'Site allowance',
    type: 'ADDITION' as const,
    category: 'ALLOWANCE' as const,
    includeIn: 'GROSS_AND_NET' as const,
    epfLiable: true,
    socsoLiable: true,
    eisLiable: true,
    pcbLiable: true,
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
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, name: 'Component Tenant' } }),
    );
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    await request(server()).post('/workforce/pay-components').set('Authorization', bearer).send(COMPONENT).expect(201);
  });

  it('REFUSES an undated change to what a component is liable to', async () => {
    const refused = await request(server())
      .post('/workforce/pay-components')
      .set('Authorization', bearer)
      .send({ ...COMPONENT, epfLiable: false })
      .expect(400);
    expect(refused.body.message).toMatch(/effectiveFrom/);
  });

  it('closes the old version and opens a new one, leaving the earlier period on the old treatment', async () => {
    await request(server())
      .post('/workforce/pay-components')
      .set('Authorization', bearer)
      .send({ ...COMPONENT, epfLiable: false, effectiveFrom: '2026-10-01', reason: 'Reclassified' })
      .expect(201);

    const rows = await withTenantContext(prisma, tenantId, (tx) =>
      tx.payComponent.findMany({ where: { code: COMPONENT.code }, orderBy: { effectiveFrom: 'asc' } }),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].epfLiable).toBe(true);
    expect(rows[0].effectiveTo?.toISOString().slice(0, 10)).toBe('2026-09-30');
    expect(rows[0].version).toBe(1);
    expect(rows[1].epfLiable).toBe(false);
    expect(rows[1].effectiveTo).toBeNull();
    expect(rows[1].version).toBe(2);
  });

  it('still lets a NAME be corrected without inventing a version for a typo', async () => {
    await request(server())
      .post('/workforce/pay-components')
      .set('Authorization', bearer)
      .send({ ...COMPONENT, name: 'Site allowance (outstation)' })
      .expect(201);
    const rows = await withTenantContext(prisma, tenantId, (tx) =>
      tx.payComponent.findMany({ where: { code: COMPONENT.code } }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Site allowance (outstation)');
  });

  it('refuses a treatment change dated on or before the version in force', async () => {
    const refused = await request(server())
      .post('/workforce/pay-components')
      .set('Authorization', bearer)
      .send({ ...COMPONENT, epfLiable: false, effectiveFrom: '1969-01-01' })
      .expect(400);
    expect(refused.body.message).toMatch(/which is not before/);
  });
});

describe('payroll run types (e2e)', () => {
  /*
   * `PayrollRunType` has been in the schema since Stage 2 and NOTHING EVER SET
   * IT: every run was REGULAR, and the duplicate check refused a second run of
   * any kind for the month — so a bonus paid off-cycle, a correction beside an
   * approved month and a leaver's final pay were unreachable. The types are not
   * labels: an off-cycle run that re-paid basic salary would pay somebody twice
   * in a month, and the second payslip would look exactly like the first.
   */
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;
  let legalEmployerId: string;
  const server = () => app.getHttpServer();
  const PERIOD = '2026-08';

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
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, name: 'Run Type Tenant' } }),
    );
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    clinicId = (
      await request(server()).post('/clinics').set('Authorization', bearer).send({ name: 'Branch A' }).expect(201)
    ).body.id;
    legalEmployerId = (
      await request(server())
        .post('/workforce/legal-employers')
        .set('Authorization', bearer)
        .send({ name: `Run Type Employer ${randomId().slice(0, 8)}` })
        .expect(201)
    ).body.id;
    await request(server()).post('/workforce/pay-components/seed').set('Authorization', bearer).expect(201);
  });

  async function person(name: string, salary: string) {
    const staff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: name, clinicId } }),
    );
    await request(server())
      .post(`/workforce/employees/${staff.id}`)
      .set('Authorization', bearer)
      .send({ position: 'Clinic Assistant', employmentStatus: 'ACTIVE', startDate: '2024-01-01', dateOfBirth: '1990-06-15' })
      .expect(201);
    await request(server())
      .post(`/workforce/employees/${staff.id}/statutory-classification`)
      .set('Authorization', bearer)
      .send({
        effectiveFrom: '2020-01-01',
        epfMembership: 'MALAYSIAN_CITIZEN',
        lindungParticipation: 'NOT_PARTICIPATING',
        restDayOfWeek: 0,
        pcbApplicable: false,
      })
      .expect(201);
    await request(server())
      .patch(`/workforce/employees/${staff.id}/legal-employer`)
      .set('Authorization', bearer)
      .send({ legalEmployerId })
      .expect(200);
    await request(server())
      .post(`/workforce/employees/${staff.id}/salary`)
      .set('Authorization', bearer)
      .send({ amount: salary, basis: 'MONTHLY', effectiveFrom: '2024-01-01' })
      .expect(201);
    return staff.id;
  }

  const createRun = (runType?: string) =>
    request(server())
      .post('/workforce/payroll/runs')
      .set('Authorization', bearer)
      .send({ period: PERIOD, clinicId, ...(runType ? { runType } : {}) });

  const calculate = (id: string) =>
    request(server()).patch(`/workforce/payroll/runs/${id}/calculate`).set('Authorization', bearer);

  const detail = async (id: string) =>
    (await request(server()).get(`/workforce/payroll/runs/${id}`).set('Authorization', bearer).expect(200)).body;

  it('still allows exactly one REGULAR payroll a month at a branch', async () => {
    await person('Nurul Aina', '3000.00');
    await createRun().expect(201);
    const second = await createRun().expect(409);
    expect(second.body.message).toMatch(/already exists at this branch/);
  });

  it('allows an off-cycle bonus run BESIDE the regular one, and numbers them', async () => {
    await person('Nurul Aina', '3000.00');
    await createRun().expect(201);
    const bonus = await createRun('OFF_CYCLE_BONUS').expect(201);
    expect(bonus.body.runType).toBe('OFF_CYCLE_BONUS');
    expect(bonus.body.sequence).toBe(1);
    // A second bonus round in the same month is legitimate.
    const secondBonus = await createRun('OFF_CYCLE_BONUS').expect(201);
    expect(secondBonus.body.sequence).toBe(2);
  });

  it('pays ONLY what was keyed on an off-cycle run — never basic salary a second time', async () => {
    const staffId = await person('Nurul Aina', '3000.00');
    const regular = await createRun().expect(201);
    await calculate(regular.body.id).expect(200);
    const regularDetail = await detail(regular.body.id);
    expect(Number(regularDetail.lines[0].basicSalary)).toBe(3000);

    await request(server())
      .post('/workforce/payroll/inputs')
      .set('Authorization', bearer)
      .send({
        staffId,
        period: `${PERIOD}-01`,
        componentCode: 'BONUS',
        amount: '1500.00',
        kind: 'ADDITIONAL',
        reason: 'Half-year bonus',
      })
      .expect(201);

    const bonus = await createRun('OFF_CYCLE_BONUS').expect(201);
    await calculate(bonus.body.id).expect(200);
    const bonusDetail = await detail(bonus.body.id);
    const line = bonusDetail.lines.find((l: { staffId: string }) => l.staffId === staffId);

    expect(Number(line.basicSalary)).toBe(0);
    expect(Number(line.grossPay)).toBe(1500);
    // Statutory still applies to what IS paid — a bonus is EPF wages.
    expect(Number(line.epfEmployee)).toBeGreaterThan(0);
  });

  it('leaves somebody with nothing keyed OFF an off-cycle run, and says so', async () => {
    const paid = await person('Gets A Bonus', '3000.00');
    await person('Gets Nothing', '2800.00');
    await request(server())
      .post('/workforce/payroll/inputs')
      .set('Authorization', bearer)
      .send({ staffId: paid, period: `${PERIOD}-01`, componentCode: 'BONUS', amount: '900.00', kind: 'ADDITIONAL' })
      .expect(201);

    const bonus = await createRun('OFF_CYCLE_BONUS').expect(201);
    const calculated = await calculate(bonus.body.id).expect(200);
    const bonusDetail = await detail(bonus.body.id);

    expect(bonusDetail.lines).toHaveLength(1);
    expect(bonusDetail.lines[0].staffId).toBe(paid);
    const exceptions = calculated.body.exceptions as { name: string; issue: string }[];
    expect(exceptions.some((row) => row.name === 'Gets Nothing' && /Nothing is keyed/.test(row.issue))).toBe(true);

    // INFO — an empty bonus round for most of the workforce is normal, and a
    // screen of blockers over it would train people to click past blockers.
    const gate = await request(server())
      .get(`/workforce/payroll/runs/${bonus.body.id}/exceptions`)
      .set('Authorization', bearer)
      .expect(200);
    const row = (gate.body.exceptions as { code: string; severity: string }[]).find(
      (e) => e.code === 'NOTHING_TO_PAY_OFF_CYCLE',
    );
    expect(row!.severity).toBe('INFO');
  });

  it('REFUSES a final payment rather than producing one that is short', async () => {
    await person('Leaving Soon', '3000.00');
    const final = await createRun('FINAL_PAY').expect(201);
    const refused = await calculate(final.body.id).expect(400);
    // Named, with the sections that are missing and what to do instead.
    expect(refused.body.message).toMatch(/section 60E/);
    expect(refused.body.message).toMatch(/notice pay/);
    expect(refused.body.message).toMatch(/payroll inputs/);
  });

  it('carries the run type into the frozen record', async () => {
    const staffId = await person('Nurul Aina', '3000.00');
    await request(server())
      .post('/workforce/payroll/inputs')
      .set('Authorization', bearer)
      .send({ staffId, period: `${PERIOD}-01`, componentCode: 'BONUS', amount: '1000.00', kind: 'ADDITIONAL' })
      .expect(201);
    const bonus = await createRun('OFF_CYCLE_BONUS').expect(201);
    await calculate(bonus.body.id).expect(200);
    await request(server())
      .patch(`/workforce/payroll/runs/${bonus.body.id}/approve`)
      .set('Authorization', bearer)
      .send({})
      .expect(200);

    const snapshot = (
      await request(server())
        .get(`/workforce/payroll/runs/${bonus.body.id}/snapshots/1`)
        .set('Authorization', bearer)
        .expect(200)
    ).body;
    expect(snapshot.payload.runType).toBe('OFF_CYCLE_BONUS');
    expect(snapshot.payload.sequence).toBe(1);
    expect(snapshot.verification.verdict).toBe('VERIFIED');
  });
});
