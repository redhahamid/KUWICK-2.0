import { PrismaClient, Role } from '@prisma/client';
import { createOwnerTestPrismaClient, createTestPrismaClient, randomId, withTenantContext } from './test-db';

// Proves the database-level backstop itself works, independent of any
// application code remembering to filter by tenant — the thing
// tenant-isolation.e2e-spec.ts assumes is true one layer down. Uses a raw,
// unscoped PrismaClient directly (not TENANT_SCOPED_PRISMA) specifically so
// these tests can exercise "no tenant context set at all," which the app's
// own client would refuse to do (core/tenant-scoped-prisma.provider.ts
// throws in that case) — that refusal is a *different* safety net, and
// this file is deliberately testing the one underneath it: Postgres RLS
// with FORCE ROW LEVEL SECURITY (docs/DECISIONS.md, force_rls_core_
// foundation and add_appointment_module migrations).
describe('Row-Level Security enforcement (e2e, DB-level)', () => {
  let prisma: PrismaClient;
  // Only for clearing append-only rows in afterEach — see createOwnerTestPrismaClient.
  let owner: PrismaClient;
  let tenantA: string;
  let tenantB: string;

  beforeAll(() => {
    prisma = createTestPrismaClient();
    owner = createOwnerTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    tenantA = randomId();
    tenantB = randomId();
    await withTenantContext(prisma, tenantA, (tx) =>
      tx.tenant.create({ data: { id: tenantA, name: 'RLS Tenant A' } }),
    );
    await withTenantContext(prisma, tenantB, (tx) =>
      tx.tenant.create({ data: { id: tenantB, name: 'RLS Tenant B' } }),
    );
  });

  afterEach(async () => {
    for (const tenantId of [tenantA, tenantB]) {
      // Audit rows hold a foreign key to their tenant and the application role
      // has no DELETE on them — the append-only guarantee working as intended.
      await withTenantContext(owner, tenantId, (tx) => tx.auditLog.deleteMany({ where: { tenantId } }));
      await withTenantContext(prisma, tenantId, async (tx) => {
        await tx.visit.deleteMany({ where: { tenantId } });
        await tx.patient.deleteMany({ where: { tenantId } });
        await tx.clinic.deleteMany({ where: { tenantId } });
        await tx.item.deleteMany({ where: { tenantId } });
        await tx.staff.deleteMany({ where: { tenantId } });
        await tx.tenant.deleteMany({ where: { id: tenantId } });
      });
    }
  });

  it('a session with no app.tenant_id set sees zero rows on a Core Foundation table (tenants)', async () => {
    // No withTenantContext wrapper — this connection has never had
    // app.tenant_id set, which is exactly the state a stray raw query
    // (CODING_STANDARDS.md §6) would run under.
    const rows = await prisma.tenant.findMany({ where: { id: { in: [tenantA, tenantB] } } });
    expect(rows).toEqual([]);
  });

  it('a session with no app.tenant_id set sees zero rows on an Inventory-module table (items)', async () => {
    await withTenantContext(prisma, tenantA, (tx) =>
      tx.item.create({ data: { tenantId: tenantA, name: 'RLS Test Item', sellPrice: 10 } }),
    );

    const rows = await prisma.item.findMany({ where: { tenantId: tenantA } });
    expect(rows).toEqual([]);
  });

  it('a session with no app.tenant_id set sees zero rows on an Appointment-module table (staff)', async () => {
    await withTenantContext(prisma, tenantA, (tx) =>
      tx.staff.create({ data: { tenantId: tenantA, role: Role.DOCTOR_RESIDENT, fullName: 'RLS Test Doctor' } }),
    );

    const rows = await prisma.staff.findMany({ where: { tenantId: tenantA } });
    expect(rows).toEqual([]);
  });

  it('a session with no app.tenant_id set sees zero rows on a Clinical-module table (visits)', async () => {
    await withTenantContext(prisma, tenantA, async (tx) => {
      const clinic = await tx.clinic.create({ data: { tenantId: tenantA, name: 'RLS Test Clinic' } });
      const patient = await tx.patient.create({
        data: { tenantId: tenantA, identifierType: 'NRIC', identifierValue: '900101015009', name: 'RLS Test Patient' },
      });
      const staff = await tx.staff.create({
        data: { tenantId: tenantA, role: Role.DOCTOR_RESIDENT, fullName: 'RLS Test Doctor' },
      });
      await tx.visit.create({
        data: {
          tenantId: tenantA,
          clinicId: clinic.id,
          patientId: patient.id,
          staffId: staff.id,
          visitNumber: 'V-000001',
          billingType: 'Self-pay',
        },
      });
    });

    const rows = await prisma.visit.findMany({ where: { tenantId: tenantA } });
    expect(rows).toEqual([]);
  });

  it("tenant A's session cannot see tenant B's rows in the same table", async () => {
    await withTenantContext(prisma, tenantB, (tx) =>
      tx.staff.create({ data: { tenantId: tenantB, role: Role.DOCTOR_RESIDENT, fullName: 'Tenant B Doctor' } }),
    );

    const rowsAsA = await withTenantContext(prisma, tenantA, (tx) =>
      tx.staff.findMany({ where: { tenantId: tenantB } }),
    );
    expect(rowsAsA).toEqual([]);
  });

  it('an INSERT with no app.tenant_id set is rejected outright, not just hidden on read', async () => {
    // tenants' policy is USING (id = current_setting('app.tenant_id', true)):
    // with no session variable set, current_setting returns NULL, and
    // `id = NULL` is never true — even for a brand-new row being inserted.
    await expect(
      prisma.tenant.create({ data: { id: randomId(), name: 'Should never be written' } }),
    ).rejects.toThrow();

    const rows = await withTenantContext(prisma, tenantA, (tx) =>
      tx.tenant.findMany({ where: { name: 'Should never be written' } }),
    );
    expect(rows).toEqual([]);
  });

  it('an INSERT whose tenant_id does not match the session context is rejected', async () => {
    // Defense in depth: even if application code's currentTenantId() were
    // ever buggy or bypassed, RLS's WITH CHECK still refuses a write into
    // a different tenant than the one the connection is scoped to.
    await expect(
      withTenantContext(prisma, tenantA, (tx) =>
        tx.staff.create({
          data: { tenantId: tenantB, role: Role.DOCTOR_RESIDENT, fullName: 'Cross-tenant write attempt' },
        }),
      ),
    ).rejects.toThrow();

    const rows = await withTenantContext(prisma, tenantB, (tx) =>
      tx.staff.findMany({ where: { fullName: 'Cross-tenant write attempt' } }),
    );
    expect(rows).toEqual([]);
  });

  it("PHASE 8: a clinic's message templates are invisible without its tenant context", async () => {
    // The templates carry the clinic's own patient-facing words — one
    // tenant's wording must never leak into another's editor. Same
    // ENABLE + FORCE + tenant_isolation policy as every appointment table.
    await withTenantContext(prisma, tenantA, async (tx) => {
      const clinic = await tx.clinic.create({ data: { tenantId: tenantA, name: 'RLS Template Clinic' } });
      await tx.appointmentMessageTemplate.create({
        data: {
          tenantId: tenantA,
          clinicId: clinic.id,
          templateKey: 'REMINDER',
          language: 'en',
          body: 'Hi {patient_name}, private wording of tenant A.',
        },
      });
    });

    // No context at all: zero rows.
    expect(await prisma.appointmentMessageTemplate.findMany({ where: { tenantId: tenantA } })).toEqual([]);
    // Tenant B's session: zero rows.
    expect(
      await withTenantContext(prisma, tenantB, (tx) =>
        tx.appointmentMessageTemplate.findMany({ where: { tenantId: tenantA } }),
      ),
    ).toEqual([]);
    // Its own session: the row is there.
    expect(
      await withTenantContext(prisma, tenantA, (tx) =>
        tx.appointmentMessageTemplate.findMany({ where: { tenantId: tenantA } }),
      ),
    ).toHaveLength(1);

    await withTenantContext(prisma, tenantA, (tx) =>
      tx.appointmentMessageTemplate.deleteMany({ where: { tenantId: tenantA } }),
    );
  });

  it("FINAL-UAT: a clinic's custom roles are invisible without its tenant context", async () => {
    // A custom role names a tenant's own permission bundle — one tenant's
    // access design must never leak into another's role editor. Same
    // ENABLE + FORCE + tenant_isolation policy as every access table.
    await withTenantContext(prisma, tenantA, async (tx) => {
      const holder = await tx.staff.create({
        data: { tenantId: tenantA, role: Role.OWNER_ADMIN, fullName: 'RLS Role Author' },
      });
      await tx.clinicCustomRole.create({
        data: {
          tenantId: tenantA,
          name: 'RLS Branch Manager',
          permissions: ['appointment.view'],
          createdByStaffId: holder.id,
        },
      });
    });

    expect(await prisma.clinicCustomRole.findMany({ where: { tenantId: tenantA } })).toEqual([]);
    expect(
      await withTenantContext(prisma, tenantB, (tx) =>
        tx.clinicCustomRole.findMany({ where: { tenantId: tenantA } }),
      ),
    ).toEqual([]);
    expect(
      await withTenantContext(prisma, tenantA, (tx) =>
        tx.clinicCustomRole.findMany({ where: { tenantId: tenantA } }),
      ),
    ).toHaveLength(1);

    await withTenantContext(prisma, tenantA, async (tx) => {
      await tx.clinicCustomRole.deleteMany({ where: { tenantId: tenantA } });
      await tx.staff.deleteMany({ where: { tenantId: tenantA, fullName: 'RLS Role Author' } });
    });
  });
  it('an audit trail cannot be read across tenants, or without a tenant at all', async () => {
    // `audit_logs` was deliberately outside the original RLS sweep — a table of
    // clinical create/update diffs, already protected by RBAC on the records
    // themselves. The admin programme changed what is in it: basic salary
    // before-and-after, payroll adjustment reasons, payment reversals,
    // credit-note approvals. That is the most sensitive per-person data in the
    // system, and it was one unscoped SELECT away from crossing tenants.
    await withTenantContext(prisma, tenantA, async (tx) => {
      await tx.auditLog.create({
        data: {
          tenantId: tenantA,
          action: 'employee.updated',
          entityType: 'EmployeeProfile',
          entityId: randomId(),
          before: { basicSalary: '4200.00' },
          after: { basicSalary: '4800.00', _reason: 'Annual review' },
        },
      });
    });

    // No tenant context at all: the backstop, not the application's own guard.
    expect(await prisma.auditLog.findMany({ where: { tenantId: tenantA } })).toEqual([]);
    // The other tenant, asking directly for A's rows by id.
    expect(
      await withTenantContext(prisma, tenantB, (tx) => tx.auditLog.findMany({ where: { tenantId: tenantA } })),
    ).toEqual([]);
    // And the owning tenant still sees its own.
    expect(
      await withTenantContext(prisma, tenantA, (tx) => tx.auditLog.findMany({ where: { tenantId: tenantA } })),
    ).toHaveLength(1);
  });

  it('an audit row cannot be written into another tenant', async () => {
    // The WITH CHECK half of the policy. Without it, a mis-set tenantId would
    // file a salary change in somebody else's audit trail — invisible to the
    // tenant it concerns and visible to one it does not.
    await expect(
      withTenantContext(prisma, tenantA, (tx) =>
        tx.auditLog.create({
          data: {
            tenantId: tenantB,
            action: 'payroll.adjusted',
            entityType: 'PayrollRun',
            entityId: randomId(),
            after: { amount: '900.00' },
          },
        }),
      ),
    ).rejects.toThrow();
  });
});
