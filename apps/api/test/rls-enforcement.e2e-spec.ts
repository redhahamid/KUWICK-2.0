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
      // The audit trail is append-only FOR EVERY ROLE now — the table owner
      // included — so audit rows cannot be cleaned up, and the tenant row
      // they reference stays behind with them. That is the guarantee working,
      // not a leak worth defeating: these are random-id tenants in a test
      // database, exactly like the ones every other suite leaves in place.
      await withTenantContext(prisma, tenantId, async (tx) => {
        await tx.visit.deleteMany({ where: { tenantId } });
        await tx.patient.deleteMany({ where: { tenantId } });
        await tx.clinic.deleteMany({ where: { tenantId } });
        await tx.item.deleteMany({ where: { tenantId } });
        await tx.staff.deleteMany({ where: { tenantId } });
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
  it("PAYABLES: what a clinic owes its suppliers is invisible without its tenant context", async () => {
    // A payable listing names a clinic's suppliers, its commercial terms and
    // its cash position — one tenant seeing another's is a commercial leak, not
    // just a privacy one. Same ENABLE + FORCE + tenant_isolation policy as
    // every other money table.
    await withTenantContext(prisma, tenantA, async (tx) => {
      const holder = await tx.staff.create({
        data: { tenantId: tenantA, role: Role.OWNER_ADMIN, fullName: 'RLS Payables Clerk' },
      });
      const supplier = await tx.supplier.create({
        data: { tenantId: tenantA, name: 'RLS Supplier', paymentTermDays: 30, creditLimitAmount: 1000 },
      });
      const invoice = await tx.supplierInvoice.create({
        data: {
          tenantId: tenantA,
          supplierId: supplier.id,
          invoiceNumber: 'RLS-1',
          invoiceDate: new Date('2026-08-01T00:00:00.000Z'),
          totalAmount: 250,
          recordedByStaffId: holder.id,
        },
      });
      await tx.supplierPayment.create({
        data: {
          tenantId: tenantA,
          supplierId: supplier.id,
          paidAt: new Date('2026-08-10T00:00:00.000Z'),
          amount: 250,
          recordedByStaffId: holder.id,
          allocations: {
            create: [{ tenantId: tenantA, supplierInvoiceId: invoice.id, amount: 250 }],
          },
        },
      });
    });

    // No tenant context at all.
    expect(await prisma.supplierInvoice.findMany({ where: { tenantId: tenantA } })).toEqual([]);
    expect(await prisma.supplierPayment.findMany({ where: { tenantId: tenantA } })).toEqual([]);
    expect(await prisma.supplierPaymentAllocation.findMany({ where: { tenantId: tenantA } })).toEqual([]);

    // Another tenant's context.
    expect(
      await withTenantContext(prisma, tenantB, (tx) =>
        tx.supplierInvoice.findMany({ where: { tenantId: tenantA } }),
      ),
    ).toEqual([]);
    expect(
      await withTenantContext(prisma, tenantB, (tx) =>
        tx.supplierPaymentAllocation.findMany({ where: { tenantId: tenantA } }),
      ),
    ).toEqual([]);

    // Its own context sees it.
    expect(
      await withTenantContext(prisma, tenantA, (tx) =>
        tx.supplierInvoice.findMany({ where: { tenantId: tenantA } }),
      ),
    ).toHaveLength(1);

    await withTenantContext(prisma, tenantA, async (tx) => {
      await tx.supplierPaymentAllocation.deleteMany({ where: { tenantId: tenantA } });
      await tx.supplierPayment.deleteMany({ where: { tenantId: tenantA } });
      await tx.supplierInvoice.deleteMany({ where: { tenantId: tenantA } });
      await tx.supplier.deleteMany({ where: { tenantId: tenantA, name: 'RLS Supplier' } });
      await tx.staff.deleteMany({ where: { tenantId: tenantA, fullName: 'RLS Payables Clerk' } });
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

  /*
   * THE SWEEP — every tenant-scoped table, not the handful somebody remembered.
   *
   * The tests above prove RLS works on the tables they name. What none of them
   * proves is that a table added next month has it at all: a new model without
   * ENABLE/FORCE in its migration is not a failing test, it is a silent hole
   * that the application's own scoping hides until something reads outside it.
   *
   * So this asks Postgres directly. The rule is mechanical and needs no list to
   * maintain: a table with a tenant column is tenant data and must have RLS
   * both ENABLED and FORCED. FORCE is the half that matters most — without it
   * the table's owner bypasses every policy, and migrations run as the owner.
   *
   * The column is `tenant_id`, not `tenantId`: Prisma's field name is mapped,
   * and the first version of this sweep asked for the FIELD name, matched no
   * tables at all and passed green while proving nothing. Hence the population
   * assertion below — a sweep that can go vacuous is worse than no sweep,
   * because it reads like coverage.
   */
  it('EVERY table carrying a tenant column has RLS enabled AND forced', async () => {
    const gaps = await prisma.$queryRaw<{ table: string; enabled: boolean; forced: boolean }[]>`
      SELECT c.relname AS "table", c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND EXISTS (
          SELECT 1 FROM information_schema.columns col
          WHERE col.table_schema = 'public'
            AND col.table_name = c.relname
            AND col.column_name = 'tenant_id'
        )
        AND (c.relrowsecurity IS FALSE OR c.relforcerowsecurity IS FALSE)
      ORDER BY c.relname
    `;
    // Named, so a failure says which table and which half is missing rather
    // than only that the count moved.
    expect(gaps.map((row) => `${row.table} (enabled=${row.enabled}, forced=${row.forced})`)).toEqual([]);

    // AND THE SWEEP ACTUALLY SWEPT SOMETHING. Without this the query above
    // passes just as happily against a predicate that matches nothing.
    const [{ count }] = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND EXISTS (
          SELECT 1 FROM information_schema.columns col
          WHERE col.table_schema = 'public'
            AND col.table_name = c.relname
            AND col.column_name = 'tenant_id'
        )
    `;
    expect(Number(count)).toBeGreaterThan(50);
  });

  it('every tenant-scoped table actually carries an isolation policy', async () => {
    // ENABLE with no policy is deny-all, which looks secure and is in fact a
    // table nothing can read — a different failure, equally worth catching
    // before it reaches a clinic.
    const unpoliced = await prisma.$queryRaw<{ table: string }[]>`
      SELECT c.relname AS "table"
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relrowsecurity IS TRUE
        AND EXISTS (
          SELECT 1 FROM information_schema.columns col
          WHERE col.table_schema = 'public'
            AND col.table_name = c.relname
            AND col.column_name = 'tenant_id'
        )
        AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname)
      ORDER BY c.relname
    `;
    expect(unpoliced.map((row) => row.table)).toEqual([]);
  });

  it('the two tables this HR pass added are covered by that sweep', async () => {
    // A sweep that silently matches nothing passes for the wrong reason. This
    // names the tables the pass introduced and asserts they are actually in
    // the population the sweep examines.
    const covered = await prisma.$queryRaw<{ table: string; enabled: boolean; forced: boolean }[]>`
      SELECT c.relname AS "table", c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN ('attendance_policies', 'attendance_correction_requests')
      ORDER BY c.relname
    `;
    expect(covered).toEqual([
      { table: 'attendance_correction_requests', enabled: true, forced: true },
      { table: 'attendance_policies', enabled: true, forced: true },
    ]);
  });
});
