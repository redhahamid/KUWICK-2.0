import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

/**
 * ONE CANONICAL SOURCE FOR PAYROLL EXCEPTION STATE.
 *
 * The run carries its exceptions twice: a legacy `exceptions` JSON blob on
 * `payroll_runs`, and structured rows in `payroll_exceptions`. While the run
 * list and the banner read the blob and the approval gate read the rows, the
 * screen could say "5 exception(s) must be resolved before this run can be
 * approved" beside an enabled Approve button, with an exception centre below
 * reporting none. Everything operational now reads the ROWS.
 *
 * These tests are written so that they FAIL if any endpoint goes back to the
 * blob: the decisive ones deliberately drive the two apart and then check that
 * every endpoint followed the rows.
 */
describe('payroll exception state has one canonical source (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;
  let runId: string;

  const PERIOD = '2026-08';
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

  async function employee(name: string, opts: { salary?: string; pcbApplicable?: boolean } = {}) {
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
        pcbApplicable: opts.pcbApplicable ?? false,

      })
      .expect(201);

    // Salary is recorded with the date it takes effect from — the one way
    // payroll reads it. Backdated so any period in this suite resolves it.
    if (opts.salary) {
      await request(app.getHttpServer())
        .post(`/workforce/employees/${staff.id}/salary`)
        .set('Authorization', bearer)
        .send({ amount: opts.salary, basis: 'MONTHLY', effectiveFrom: '2024-01-01', reason: 'Starting salary' })
        .expect(201);
    }
    return staff.id;
  }

  const gateOf = async () =>
    (await request(server()).get(`/workforce/payroll/runs/${runId}/exceptions`).set('Authorization', bearer).expect(200))
      .body;

  const listedRun = async () => {
    const list = await request(server()).get('/workforce/payroll/runs').set('Authorization', bearer).expect(200);
    return list.body.find((r: { id: string }) => r.id === runId);
  };

  beforeEach(async () => {
    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, name: 'Exception Source Tenant' } }),
    );
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;

    const clinic = await request(server())
      .post('/clinics')
      .set('Authorization', bearer)
      .send({ name: 'Branch A' })
      .expect(201);
    clinicId = clinic.body.id;

    await request(server()).post('/workforce/pay-components/seed').set('Authorization', bearer).expect(201);

    // Three people who cannot be paid, for two different reasons — the shape
    // the admin UAT clinic seeds and the one the screen is reviewed against.
    await employee('No Salary One');
    await employee('No Salary Two');
    await employee('Needs PCB One', { salary: '3200', pcbApplicable: true });
    await employee('Needs PCB Two', { salary: '2600', pcbApplicable: true });
    await employee('Needs PCB Three', { salary: '2900', pcbApplicable: true });

    const run = await request(server())
      .post('/workforce/payroll/runs')
      .set('Authorization', bearer)
      .send({ period: `${PERIOD}-01`, clinicId })
      .expect(201);
    runId = run.body.id;
    await request(server()).patch(`/workforce/payroll/runs/${runId}/calculate`).set('Authorization', bearer).expect(200);
  });

  it('1. calculate writes a row for every exception, not only the legacy blob', async () => {
    const { exceptions, gate } = await gateOf();
    expect(exceptions.length).toBeGreaterThan(0);
    expect(gate.total).toBe(exceptions.length);

    const run = await withTenantContext(prisma, tenantId, (tx) =>
      tx.payrollRun.findFirstOrThrow({ where: { id: runId } }),
    );
    // Both stores are written; the blob is kept for compatibility. What matters
    // is that they START in agreement — the drift tests below prove which one
    // the endpoints follow when they stop agreeing.
    expect((run.exceptions as unknown[]).length).toBe(gate.total);
  });

  it('2. the run list reports the gate, not a bare count, and it matches the exceptions endpoint exactly', async () => {
    const { gate } = await gateOf();
    const row = await listedRun();
    expect(row.exceptions).toEqual(gate);
  });

  it('3. the run detail payload carries NO exception state for a second surface to read', async () => {
    const detail = await request(server())
      .get(`/workforce/payroll/runs/${runId}`)
      .set('Authorization', bearer)
      .expect(200);
    // The field the banner used to render. Its absence is the fix: there is
    // nowhere for a UI surface to get a second opinion from.
    expect(detail.body).not.toHaveProperty('exceptions');
  });

  it('4. approval is refused, and the refusal quotes the same blocking count the gate reports', async () => {
    const { gate } = await gateOf();
    expect(gate.canApprove).toBe(false);
    expect(gate.blocking).toBeGreaterThan(0);

    const refused = await request(server())
      .patch(`/workforce/payroll/runs/${runId}/approve`)
      .set('Authorization', bearer)
      .send({ acknowledgeStatutoryGap: true })
      .expect(400);
    expect(refused.body.message).toContain(`${gate.blocking} blocking exception(s)`);
  });

  it('5. THE DRIFT TEST — with the rows gone, every endpoint reports zero even though the blob still holds them', async () => {
    // This is the assertion that would have caught the original defect. The
    // seeded admin clinic wrote the blob and no rows; here the blob is left
    // populated and the rows removed. An endpoint still reading the blob would
    // keep reporting exceptions.
    await withTenantContext(prisma, tenantId, (tx) => tx.payrollException.deleteMany({ where: { payrollRunId: runId } }));

    const run = await withTenantContext(prisma, tenantId, (tx) =>
      tx.payrollRun.findFirstOrThrow({ where: { id: runId } }),
    );
    expect((run.exceptions as unknown[]).length).toBeGreaterThan(0); // the blob is untouched

    const { gate, exceptions } = await gateOf();
    expect(exceptions).toEqual([]);
    expect(gate).toMatchObject({ total: 0, blocking: 0, warnings: 0, canApprove: true });

    const row = await listedRun();
    expect(row.exceptions).toEqual(gate);
  });

  it('6. THE DRIFT TEST, the other way — a row nothing put in the blob is still counted everywhere', async () => {
    const before = (await gateOf()).gate;

    await withTenantContext(prisma, tenantId, (tx) =>
      tx.payrollException.create({
        data: {
          tenantId,
          payrollRunId: runId,
          severity: 'WARNING',
          code: 'NO_BANK_DETAILS',
          cause: 'No bank account is recorded for this employee.',
          consequence: 'They cannot be included in a bank payment file.',
          remediation: 'Record the bank details.',
          overridable: true,
        },
      }),
    );

    const after = (await gateOf()).gate;
    expect(after.total).toBe(before.total + 1);
    expect(after.warnings).toBe(before.warnings + 1);
    // Still refused for the same blocking reasons — a warning changes the
    // counts and not the verdict.
    expect(after.blocking).toBe(before.blocking);

    const row = await listedRun();
    expect(row.exceptions).toEqual(after);
  });

  it('7. severity semantics survive: only BLOCKING gates, and an override is recorded on both counts', async () => {
    const created = await withTenantContext(prisma, tenantId, (tx) =>
      tx.payrollException.create({
        data: {
          tenantId,
          payrollRunId: runId,
          severity: 'WARNING',
          code: 'MISSING_PUNCH',
          cause: '2 day(s) have a missing clock-in or clock-out.',
          consequence: 'Hours for those days are incomplete.',
          remediation: 'Correct the attendance records, then recalculate.',
          overridable: true,
        },
      }),
    );

    await request(server())
      .patch(`/workforce/payroll/exceptions/${created.id}/override`)
      .set('Authorization', bearer)
      .send({ reason: 'Confirmed against the door log' })
      .expect(200);

    const { gate } = await gateOf();
    expect(gate.overridden).toBe(1);
    // A passed WARNING was never blocking, so the verdict does not move.
    expect(gate.canApprove).toBe(false);
    expect((await listedRun()).exceptions).toEqual(gate);
  });

  it('8. a non-overridable blocker cannot be passed, and the refusal says why', async () => {
    const { exceptions } = await gateOf();
    const blocker = exceptions.find((e: { overridable: boolean }) => !e.overridable);
    expect(blocker).toBeDefined();

    const refused = await request(server())
      .patch(`/workforce/payroll/exceptions/${blocker.id}/override`)
      .set('Authorization', bearer)
      .send({ reason: 'We will sort it out afterwards' })
      .expect(400);
    expect(refused.body.message).toContain('cannot be overridden');

    expect((await gateOf()).gate.overridden).toBe(0);
  });

  it('9. once every blocker is resolved, the same three surfaces all say approvable', async () => {
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.payrollException.deleteMany({ where: { payrollRunId: runId, severity: 'BLOCKING' } }),
    );
    const { gate } = await gateOf();
    expect(gate.canApprove).toBe(true);
    expect((await listedRun()).exceptions).toEqual(gate);

    await request(server())
      .patch(`/workforce/payroll/runs/${runId}/approve`)
      .set('Authorization', bearer)
      .send({ acknowledgeStatutoryGap: true })
      .expect(200);
  });
});
