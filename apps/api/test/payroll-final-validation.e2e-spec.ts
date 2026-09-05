import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient, Role } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { bearerFor, createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();
const OWNER_URL = process.env.TEST_OWNER_DATABASE_URL;

/**
 * FINAL-VALIDATION NEGATIVE COVERAGE.
 *
 * Every test here pins a door the takeover audit found open — or found
 * guarded by convention with nothing proving the guard. The style is the
 * negative case first: what must be REFUSED, WITHHELD, or ABSENT.
 */
describe('Payroll final-validation guards (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let ownerStaffId: string;
  let clinicA: string;
  let clinicB: string;
  let legalEmployerId: string;

  const server = () => app.getHttpServer();
  const PERIOD = '2026-07';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, name: 'Final Validation Tenant' } }),
    );
    const owner = await createOwnerAndBearer(prisma, tenantId);
    bearer = owner.bearer;
    ownerStaffId = owner.staffId;

    const a = await request(server()).post('/clinics').set('Authorization', bearer).send({ name: 'Branch A' }).expect(201);
    clinicA = a.body.id;
    const b = await request(server()).post('/clinics').set('Authorization', bearer).send({ name: 'Branch B' }).expect(201);
    clinicB = b.body.id;

    const employer = await request(server())
      .post('/workforce/legal-employers')
      .set('Authorization', bearer)
      .send({ name: 'Validation Sdn Bhd', bankName: 'Bank Contoh', bankAccountNo: '5123456789012', bankAccountName: 'Validation Sdn Bhd' })
      .expect(201);
    legalEmployerId = employer.body.id;

    await request(server()).post('/workforce/pay-components/seed').set('Authorization', bearer).expect(201);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  async function makeEmployee(name: string, clinicId: string, salary = '3000.00'): Promise<string> {
    const staff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: name, clinicId } }),
    );
    await request(server())
      .post(`/workforce/employees/${staff.id}`)
      .set('Authorization', bearer)
      .send({
        employeeNo: `V-${Math.floor(Math.random() * 1000000)}`,
        position: 'Clinic Assistant',
        employmentType: 'PERMANENT',
        employmentStatus: 'ACTIVE',
        startDate: '2024-01-01',
        dateOfBirth: '1992-05-05',
        bankName: 'Maybank',
        bankAccountNo: `514412345678`,
        epfNumber: 'EPF-1234',
        socsoNumber: 'SOCSO-1234',
        taxNumber: 'SG 12345678090',
      })
      .expect(201);
    await request(server())
      .post(`/workforce/employees/${staff.id}/statutory-classification`)
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

  describe('what a payroll read may carry', () => {
    let staffId: string;

    beforeAll(async () => {
      staffId = await makeEmployee('Projection Probe', clinicA);
    });

    it('payroll-detail carries presence and last-four, never the account number or the NRIC', async () => {
      const res = await request(server())
        .get(`/workforce/employees/${staffId}/payroll-detail`)
        .set('Authorization', bearer)
        .expect(200);
      // The figures payroll needs are there…
      expect(Number(res.body.basicSalary)).toBe(3000);
      expect(res.body.epfNumber).toBe('EPF-1234');
      // …and the fields the audit found riding along are not.
      expect(res.body.bankAccountNo).toBeUndefined();
      expect(res.body.identifierValue).toBeUndefined();
      expect(res.body.bankAccountOnFile).toBe(true);
      expect(res.body.bankAccountLastFour).toBe('5678');
    });

    it('the legal-employer list masks the employer bank account to its last four', async () => {
      const res = await request(server()).get('/workforce/legal-employers').set('Authorization', bearer).expect(200);
      const row = res.body.find((r: { id: string }) => r.id === legalEmployerId);
      expect(row.bankAccountNo).toBeUndefined();
      expect(row.bankAccountOnFile).toBe(true);
      expect(row.bankAccountLastFour).toBe('9012');
    });

    it('an employer edit that does not mention the bank account keeps it, not clears it', async () => {
      await request(server())
        .post('/workforce/legal-employers')
        .set('Authorization', bearer)
        .send({ id: legalEmployerId, name: 'Validation Sdn Bhd', bankName: 'Bank Contoh', bankAccountName: 'Validation Sdn Bhd' })
        .expect(201);
      const row = await withTenantContext(prisma, tenantId, (tx) =>
        tx.legalEmployer.findFirst({ where: { id: legalEmployerId } }),
      );
      expect(row?.bankAccountNo).toBe('5123456789012');
    });
  });

  describe('who may write pay', () => {
    it('an HR clerk (hr.employee.manage, no payroll access) cannot set a salary', async () => {
      const clerkStaff = await withTenantContext(prisma, tenantId, (tx) =>
        tx.staff.create({ data: { tenantId, role: Role.HR_STAFF, fullName: 'HR Clerk', clinicId: clinicA } }),
      );
      const clerk = bearerFor(tenantId, clerkStaff.id, Role.HR_STAFF);
      const target = await makeEmployee('Salary Target', clinicA);
      const refused = await request(server())
        .post(`/workforce/employees/${target}/salary`)
        .set('Authorization', clerk)
        .send({ amount: '9999.00', basis: 'MONTHLY', effectiveFrom: '2026-01-01', reason: 'Should be refused' });
      expect(refused.status).toBe(403);
      expect(refused.body.message).toMatch(/payroll access/i);
    });
  });

  describe('the run lifecycle holds its shape', () => {
    let runId: string;

    beforeAll(async () => {
      await makeEmployee('Runner One', clinicA, '3100.00');
      const run = await request(server())
        .post('/workforce/payroll/runs')
        .set('Authorization', bearer)
        .send({ period: PERIOD, clinicId: clinicA })
        .expect(201);
      runId = run.body.id;
      await request(server()).patch(`/workforce/payroll/runs/${runId}/calculate`).set('Authorization', bearer).expect(200);
    });

    it('the unreconciled mark-paid door is gone', async () => {
      const res = await request(server()).patch(`/workforce/payroll/runs/${runId}/paid`).set('Authorization', bearer);
      expect(res.status).toBe(404);
    });

    it('an incomplete payslip line blocks approval even with no exception row naming it', async () => {
      // Doctor one line's breakdown the way a missed-null bug would have
      // left it: incomplete, with no exception row. The gate must read the
      // FIGURES, not the exception taxonomy.
      const line = await withTenantContext(prisma, tenantId, (tx) =>
        tx.payrollLine.findFirst({ where: { payrollRunId: runId } }),
      );
      const breakdown = (line?.breakdown ?? {}) as Record<string, unknown>;
      await withTenantContext(prisma, tenantId, (tx) =>
        tx.payrollLine.update({ where: { id: line!.id }, data: { breakdown: { ...breakdown, incomplete: true } as never } }),
      );
      const refused = await request(server())
        .patch(`/workforce/payroll/runs/${runId}/approve`)
        .set('Authorization', bearer)
        .send({});
      expect(refused.status).toBe(400);
      expect(refused.body.message).toMatch(/could not be worked out/i);
      // Undo, and recalculate to restore engine truth for later tests.
      await request(server()).patch(`/workforce/payroll/runs/${runId}/calculate`).set('Authorization', bearer).expect(200);
    });

    it('under DUAL_APPROVAL, recalculation clears the first approval — nobody locks figures half-reviewed', async () => {
      await request(server())
        .put('/workforce/payroll/approval-policy')
        .set('Authorization', bearer)
        .send({ mode: 'DUAL_APPROVAL', allowOwnerSelfApproval: true })
        .expect(200);

      const approverA = await createOwnerAndBearer(prisma, tenantId);
      const approverB = await createOwnerAndBearer(prisma, tenantId);

      // First approval recorded; the run waits for a second person.
      const first = await request(server())
        .patch(`/workforce/payroll/runs/${runId}/approve`)
        .set('Authorization', approverA.bearer)
        .send({})
        .expect(200);
      expect(first.body.approvalState?.complete).toBe(false);

      // The figures change under the standing approval.
      await request(server()).patch(`/workforce/payroll/runs/${runId}/calculate`).set('Authorization', bearer).expect(200);

      // The second approver is now the FIRST approver of the new figures.
      const second = await request(server())
        .patch(`/workforce/payroll/runs/${runId}/approve`)
        .set('Authorization', approverB.bearer)
        .send({})
        .expect(200);
      expect(second.body.approvalState?.complete).toBe(false);
      expect(second.body.approvalState?.given).toBe(1);
      expect(second.body.status).not.toBe('APPROVED');

      // Two fresh approvals of the SAME figures do lock it.
      const third = await request(server())
        .patch(`/workforce/payroll/runs/${runId}/approve`)
        .set('Authorization', approverA.bearer)
        .send({})
        .expect(200);
      expect(third.body.status).toBe('APPROVED');

      // Back to STANDARD so later suites are unaffected.
      await request(server())
        .put('/workforce/payroll/approval-policy')
        .set('Authorization', bearer)
        .send({ mode: 'STANDARD', allowOwnerSelfApproval: true })
        .expect(200);
    });

    it('an approved run’s frozen record refuses rewriting even for the table owner', async () => {
      if (!OWNER_URL) throw new Error('TEST_OWNER_DATABASE_URL is not set — see .env.test.example.');
      const owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: OWNER_URL }) });
      try {
        const snapshot = await withTenantContext(prisma, tenantId, (tx) =>
          tx.payrollSnapshot.findFirst({ where: { payrollRunId: runId } }),
        );
        expect(snapshot).not.toBeNull();
        await expect(
          owner.$executeRaw`UPDATE "payroll_snapshots" SET hash = 'tampered' WHERE id = ${snapshot!.id}`,
        ).rejects.toThrow(/cannot be update/i);

        const line = await withTenantContext(prisma, tenantId, (tx) =>
          tx.payrollLine.findFirst({ where: { payrollRunId: runId } }),
        );
        await expect(
          owner.$executeRaw`UPDATE "payroll_lines" SET net_pay = 1 WHERE id = ${line!.id}`,
        ).rejects.toThrow(/approved|locked|paid/i);
      } finally {
        await owner.$disconnect();
      }
    });
  });

  describe('the audit trail is append-only', () => {
    it('refuses UPDATE and DELETE even for the table owner', async () => {
      if (!OWNER_URL) throw new Error('TEST_OWNER_DATABASE_URL is not set — see .env.test.example.');
      const owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: OWNER_URL }) });
      try {
        const row = await withTenantContext(prisma, tenantId, (tx) =>
          tx.auditLog.findFirst({ where: { tenantId } }),
        );
        expect(row).not.toBeNull();
        await expect(
          owner.$executeRaw`UPDATE "audit_logs" SET action = 'tampered' WHERE id = ${row!.id}`,
        ).rejects.toThrow(/append-only/i);
        await expect(owner.$executeRaw`DELETE FROM "audit_logs" WHERE id = ${row!.id}`).rejects.toThrow(/append-only/i);
      } finally {
        await owner.$disconnect();
      }
    });
  });

  describe('branch scope binds payroll', () => {
    let scopedBearer: string;

    beforeAll(async () => {
      // A payroll operator whose account manages branch A only: individual
      // grants for the payroll permissions, a home branch, no settings.manage.
      const operator = await withTenantContext(prisma, tenantId, (tx) =>
        tx.staff.create({ data: { tenantId, role: Role.HR_STAFF, fullName: 'Branch A Payroll', clinicId: clinicA } }),
      );
      await withTenantContext(prisma, tenantId, async (tx) => {
        for (const permission of ['hr.payroll.view', 'hr.payroll.run']) {
          await tx.staffPermissionGrant.create({
            data: {
              tenantId,
              staffId: operator.id,
              permission,
              grantedByStaffId: ownerStaffId,
              reason: 'Final-validation scope probe',
            },
          });
        }
      });
      scopedBearer = bearerFor(tenantId, operator.id, Role.HR_STAFF);
    });

    it('run rights are not delegable at all — the grant tables refuse before scope is even asked', async () => {
      // `hr.payroll.run` is deliberately absent from INDIVIDUALLY_GRANTABLE
      // and CUSTOM_ROLE_GRANTABLE, so today only an owner (tenant-wide by
      // definition) can create runs; the create-side branch-scope guard in
      // payroll.service is defence in depth for the day that changes. What
      // binds NOW is this refusal, and the read-side scope below.
      const refused = await request(server())
        .post('/workforce/payroll/runs')
        .set('Authorization', scopedBearer)
        .send({ period: '2026-08', clinicId: clinicB });
      expect(refused.status).toBe(403);
      expect(refused.body.message).toMatch(/not permitted/i);
    });

    it('run listing and readiness stay inside the managed branch', async () => {
      const runs = await request(server()).get('/workforce/payroll/runs').set('Authorization', scopedBearer).expect(200);
      for (const row of runs.body) expect(row.clinicId).toBe(clinicA);

      const outside = await request(server())
        .get(`/workforce/payroll/readiness?clinicId=${clinicB}`)
        .set('Authorization', scopedBearer);
      expect(outside.status).toBe(403);
    });
  });

  describe('tenant isolation reaches payroll', () => {
    it('another tenant’s owner cannot read this tenant’s run, snapshot or payslips', async () => {
      const otherTenant = randomId();
      await withTenantContext(prisma, otherTenant, (tx) =>
        tx.tenant.create({ data: { id: otherTenant, name: 'Other Tenant' } }),
      );
      const other = await createOwnerAndBearer(prisma, otherTenant);
      const run = await withTenantContext(prisma, tenantId, (tx) =>
        tx.payrollRun.findFirst({ where: { tenantId } }),
      );
      expect(run).not.toBeNull();
      await request(server()).get(`/workforce/payroll/runs/${run!.id}`).set('Authorization', other.bearer).expect(404);
      await request(server())
        .get(`/workforce/payroll/runs/${run!.id}/snapshots/1`)
        .set('Authorization', other.bearer)
        .expect(404);
      const payslips = await request(server())
        .get(`/workforce/payroll/runs/${run!.id}/payslips`)
        .set('Authorization', other.bearer);
      expect([403, 404, 409]).toContain(payslips.status);
    });
  });

  describe('nobody vanishes from payroll silently', () => {
    it('a branch run NAMES an employee who has no home branch — in no branch’s run at all', async () => {
      const orphanStaff = await withTenantContext(prisma, tenantId, (tx) =>
        tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'No Branch Nadia', clinicId: null } }),
      );
      await request(server())
        .post(`/workforce/employees/${orphanStaff.id}`)
        .set('Authorization', bearer)
        .send({
          employeeNo: `V-${Math.floor(Math.random() * 1000000)}`,
          position: 'Clinic Assistant',
          employmentType: 'PERMANENT',
          employmentStatus: 'ACTIVE',
          startDate: '2024-01-01',
          dateOfBirth: '1994-02-02',
        })
        .expect(201);

      const run = await request(server())
        .post('/workforce/payroll/runs')
        .set('Authorization', bearer)
        .send({ period: '2026-09', clinicId: clinicA })
        .expect(201);
      await request(server()).patch(`/workforce/payroll/runs/${run.body.id}/calculate`).set('Authorization', bearer).expect(200);

      const exceptions = await request(server())
        .get(`/workforce/payroll/runs/${run.body.id}/exceptions`)
        .set('Authorization', bearer)
        .expect(200);
      const rows = exceptions.body.exceptions ?? exceptions.body.rows ?? [];
      const named = rows.find(
        (row: { code: string; staffName?: string }) =>
          row.code === 'EMPLOYEE_IN_NO_BRANCH' && row.staffName === 'No Branch Nadia',
      );
      expect(named).toBeDefined();
      // A WARNING, not a blocker: the month can still be finished, but the
      // absence has a name on it instead of a silent missing line.
      expect(named.severity).toBe('WARNING');
    });
  });
});
