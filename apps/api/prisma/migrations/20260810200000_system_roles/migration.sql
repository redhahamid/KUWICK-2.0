-- TASK 1 — capability roles, held one-or-more per staff member.
--
-- ADDITIVE ON PURPOSE. `staff.role` — the legacy administrative job title —
-- is untouched and keeps working. The policy module falls back to a mapping
-- from it for anybody with no explicit assignment, so nothing breaks on the
-- day this ships and the migration is reversible rather than a one-way door.
CREATE TYPE "system_role" AS ENUM ('DOCTOR', 'CLINICAL_STAFF', 'ADMINISTRATOR', 'OWNER');

CREATE TABLE "staff_role_assignments" (
  "id"                   TEXT NOT NULL,
  "tenant_id"            TEXT NOT NULL,
  "staff_id"             TEXT NOT NULL,
  "role"                 "system_role" NOT NULL,
  -- Who granted a clinical capability, and when, is a question an audit will
  -- ask. Attribution is not optional here.
  "assigned_by_staff_id" TEXT NOT NULL,
  "assigned_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staff_role_assignments_pkey" PRIMARY KEY ("id")
);

-- One row per (staff, role). Granting a role twice is not a second grant.
CREATE UNIQUE INDEX "staff_role_assignments_staff_id_role_key"
  ON "staff_role_assignments" ("staff_id", "role");
CREATE INDEX "staff_role_assignments_tenant_id_role_idx"
  ON "staff_role_assignments" ("tenant_id", "role");

ALTER TABLE "staff_role_assignments" ADD CONSTRAINT "staff_role_assignments_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- CASCADE: a deleted staff member's grants go with them.
ALTER TABLE "staff_role_assignments" ADD CONSTRAINT "staff_role_assignments_staff_id_fkey"
  FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- RESTRICT: the granter must remain resolvable. Staff are deactivated, not
-- erased, so an attributed grant can always name who made it.
ALTER TABLE "staff_role_assignments" ADD CONSTRAINT "staff_role_assignments_assigned_by_fkey"
  FOREIGN KEY ("assigned_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tenant isolation, same as every other tenant-scoped table.
ALTER TABLE "staff_role_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_role_assignments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "staff_role_assignments_tenant_isolation" ON "staff_role_assignments"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
