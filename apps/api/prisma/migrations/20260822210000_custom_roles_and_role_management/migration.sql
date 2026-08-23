-- FINAL-UAT — tenant-defined CUSTOM ROLES, and the assignment table learns
-- to carry them.
--
-- A custom role is a reusable permission bundle the owner names ("Branch
-- Manager", "Inventory") and hands out through the SAME staff_role_assignments
-- join the built-in capability roles use. Its permission list is validated
-- against CUSTOM_ROLE_GRANTABLE (core/permissions.ts) on write and filtered
-- through it on read — nothing clinical, nothing owner-tier, so a custom role
-- can never mint a doctor or an owner.
--
-- ADDITIVE. Existing assignment rows keep their built-in role untouched; the
-- new CHECK admits them all (role is non-null everywhere today).
CREATE TABLE "clinic_custom_roles" (
  "id"                  TEXT NOT NULL,
  "tenant_id"           TEXT NOT NULL,
  "name"                TEXT NOT NULL,
  "description"         TEXT,
  "permissions"         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_by_staff_id" TEXT NOT NULL,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "clinic_custom_roles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "clinic_custom_roles_tenant_id_name_key"
  ON "clinic_custom_roles" ("tenant_id", "name");
CREATE INDEX "clinic_custom_roles_tenant_id_idx"
  ON "clinic_custom_roles" ("tenant_id");

ALTER TABLE "clinic_custom_roles" ADD CONSTRAINT "clinic_custom_roles_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- RESTRICT: an audit must always be able to name who defined the role.
ALTER TABLE "clinic_custom_roles" ADD CONSTRAINT "clinic_custom_roles_created_by_fkey"
  FOREIGN KEY ("created_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "clinic_custom_roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clinic_custom_roles" FORCE ROW LEVEL SECURITY;
CREATE POLICY "clinic_custom_roles_tenant_isolation" ON "clinic_custom_roles"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

-- The assignment row now carries EITHER a built-in role OR a custom one.
ALTER TABLE "staff_role_assignments" ALTER COLUMN "role" DROP NOT NULL;
ALTER TABLE "staff_role_assignments" ADD COLUMN "custom_role_id" TEXT;
ALTER TABLE "staff_role_assignments" ADD CONSTRAINT "staff_role_assignments_custom_role_id_fkey"
  FOREIGN KEY ("custom_role_id") REFERENCES "clinic_custom_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- One of the two, never neither.
ALTER TABLE "staff_role_assignments" ADD CONSTRAINT "staff_role_assignments_role_or_custom"
  CHECK ("role" IS NOT NULL OR "custom_role_id" IS NOT NULL);
CREATE UNIQUE INDEX "staff_role_assignments_staff_id_custom_role_id_key"
  ON "staff_role_assignments" ("staff_id", "custom_role_id");
