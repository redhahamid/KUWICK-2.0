-- STAGE 2.5 — WHO IS ALLOWED TO APPROVE PAYROLL
--
-- Separation of duties was a hard-coded rule in the service: the person who
-- ran the payroll could not approve it unless they held `settings.manage`.
-- That rule is right for a group with a finance department and wrong for a
-- single-doctor clinic where the owner does everything, and neither clinic
-- could say which it was — there was nothing to configure.
--
-- ADDITIVE ONLY. Nothing is dropped, no figure changes, and the default mode
-- plus the default owner exemption together reproduce EXACTLY the behaviour
-- that was hard-coded before this migration, so no existing tenant's approval
-- rule changes by being upgraded.
--
-- NOTHING HERE ESTABLISHES A STATUTORY RULE.

CREATE TYPE "PayrollApprovalMode" AS ENUM ('STANDARD', 'MAKER_CHECKER', 'DUAL_APPROVAL');

-- ---------------------------------------------------------------------------
-- 1. THE SETTING. One row per tenant, created on first read.
-- ---------------------------------------------------------------------------
CREATE TABLE "payroll_approval_policies" (
  "id"                        TEXT NOT NULL,
  "tenant_id"                 TEXT NOT NULL,
  "mode"                      "PayrollApprovalMode" NOT NULL DEFAULT 'MAKER_CHECKER',
  "allow_owner_self_approval" BOOLEAN NOT NULL DEFAULT true,
  "updated_by_staff_id"       TEXT,
  "created_at"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payroll_approval_policies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payroll_approval_policies_tenant_id_key"
  ON "payroll_approval_policies"("tenant_id");

ALTER TABLE "payroll_approval_policies"
  ADD CONSTRAINT "payroll_approval_policies_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_approval_policies"
  ADD CONSTRAINT "payroll_approval_policies_updated_by_staff_id_fkey"
  FOREIGN KEY ("updated_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 2. WHO APPROVED, one row each.
--
-- The run already carried `approved_by_staff_id`, which can hold one name.
-- Dual approval needs two, and needs them to be two DIFFERENT people — the
-- unique constraint below is what makes approving twice fail to satisfy a rule
-- whose entire purpose is a second pair of eyes.
-- ---------------------------------------------------------------------------
CREATE TABLE "payroll_run_approvals" (
  "id"                          TEXT NOT NULL,
  "tenant_id"                   TEXT NOT NULL,
  "payroll_run_id"              TEXT NOT NULL,
  "staff_id"                    TEXT NOT NULL,
  "sequence"                    INTEGER NOT NULL,
  "mode"                        "PayrollApprovalMode" NOT NULL,
  "used_owner_self_approval"    BOOLEAN NOT NULL DEFAULT false,
  "statutory_gap_acknowledged"  BOOLEAN NOT NULL DEFAULT false,
  "created_at"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_run_approvals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payroll_run_approvals_payroll_run_id_staff_id_key"
  ON "payroll_run_approvals"("payroll_run_id", "staff_id");
CREATE INDEX "payroll_run_approvals_tenant_id_payroll_run_id_idx"
  ON "payroll_run_approvals"("tenant_id", "payroll_run_id");

ALTER TABLE "payroll_run_approvals"
  ADD CONSTRAINT "payroll_run_approvals_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_run_approvals"
  ADD CONSTRAINT "payroll_run_approvals_payroll_run_id_fkey"
  FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payroll_run_approvals"
  ADD CONSTRAINT "payroll_run_approvals_staff_id_fkey"
  FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A sequence is 1 or 2 and nothing else: there is no third approval in any of
-- the three modes, so a row claiming one is a bug that should not persist.
ALTER TABLE "payroll_run_approvals"
  ADD CONSTRAINT "payroll_run_approvals_sequence_range" CHECK ("sequence" IN (1, 2));

-- ---------------------------------------------------------------------------
-- 3. BACKFILL. Every run already approved gets the approval row it always
--    implied, so the two stores never disagree about who approved what. The
--    mode recorded is MAKER_CHECKER because that — with the owner exemption —
--    is the rule those approvals were actually given under.
-- ---------------------------------------------------------------------------
INSERT INTO "payroll_run_approvals"
  ("id", "tenant_id", "payroll_run_id", "staff_id", "sequence", "mode", "created_at")
SELECT
  gen_random_uuid()::text,
  r."tenant_id",
  r."id",
  r."approved_by_staff_id",
  1,
  'MAKER_CHECKER'::"PayrollApprovalMode",
  COALESCE(r."approved_at", r."updated_at")
FROM "payroll_runs" r
WHERE r."approved_by_staff_id" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Row-level security. Same shape as every other tenant-scoped table.
-- ---------------------------------------------------------------------------
ALTER TABLE "payroll_approval_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_approval_policies" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payroll_approval_policies"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "payroll_run_approvals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_run_approvals" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payroll_run_approvals"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

-- provision-app-role.sql grants on ALL TABLES and sets default privileges, but
-- only for objects the role that ran it goes on to create. Granting here too is
-- idempotent and makes a table created by a different migration runner work
-- without a re-provision. Guarded, because on a fresh database the role may not
-- exist until provisioning runs.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kuwick_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      "payroll_approval_policies", "payroll_run_approvals"
      TO kuwick_app;
  END IF;
END $$;
