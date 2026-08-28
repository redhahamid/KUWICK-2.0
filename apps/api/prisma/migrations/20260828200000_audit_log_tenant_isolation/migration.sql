-- AUDIT LOGS GET ROW-LEVEL SECURITY.
--
-- `audit_logs` was deliberately left out of the RLS sweep in
-- 20260730100000_force_rls_core_foundation, on the reasoning recorded in
-- docs/DATABASE_ARCHITECTURE.md §2: "append-only, no read restriction needed
-- beyond RBAC". That was a fair reading of a table holding create/update diffs
-- of clinical records already protected elsewhere.
--
-- The admin programme changed what is in it. It now carries basic salary
-- before-and-after, payroll adjustment reasons, payment reversal reasons,
-- credit note approvals and stock adjustment justifications — the most
-- sensitive per-person data in the system, in a table one unscoped SELECT away
-- from crossing tenants.
--
-- Nothing in the application reads this table: `finance/admin-audit.ts` is the
-- only code that touches it and it only INSERTs, always inside a tenant-scoped
-- transaction. So the policy costs nothing today and closes the gap for every
-- reader that comes later, including a person at a psql prompt.
--
-- FORCE, not merely ENABLE: the application connects as a role that owns these
-- tables, and Postgres exempts a table's owner from RLS without FORCE — the
-- same trap that migration was written to fix.

ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "audit_logs";
CREATE POLICY tenant_isolation ON "audit_logs"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
