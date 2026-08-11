-- TASK 1 — a permission granted to ONE person, outside any role.
--
-- Owner decision: "financial corrections" is a power, not a job. Applying a
-- discount belongs to OWNER by default, but a trusted senior counter staffer
-- should hold it without inventing a fifth role for one capability.
--
-- ADDITIVE ONLY. There is no per-person revoke and there will not be one: a
-- grant that could subtract from a role would make "what can this person do"
-- answerable only by replaying two tables in the right order. To take a
-- capability away, remove the role.
CREATE TABLE "staff_permission_grants" (
  "id"                  TEXT NOT NULL,
  "tenant_id"           TEXT NOT NULL,
  "staff_id"            TEXT NOT NULL,
  "permission"          TEXT NOT NULL,
  "granted_by_staff_id" TEXT NOT NULL,
  "granted_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Why this person specifically. Not optional: a discount capability handed
  -- out with no stated reason is the one an audit cannot explain later.
  "reason"              TEXT NOT NULL,
  CONSTRAINT "staff_permission_grants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "staff_permission_grants_staff_id_permission_key"
  ON "staff_permission_grants" ("staff_id", "permission");
CREATE INDEX "staff_permission_grants_tenant_id_permission_idx"
  ON "staff_permission_grants" ("tenant_id", "permission");

ALTER TABLE "staff_permission_grants" ADD CONSTRAINT "staff_permission_grants_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_permission_grants" ADD CONSTRAINT "staff_permission_grants_staff_id_fkey"
  FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- RESTRICT: the granter must stay resolvable, so an audit can always name who
-- handed out a financial-correction power.
ALTER TABLE "staff_permission_grants" ADD CONSTRAINT "staff_permission_grants_granted_by_fkey"
  FOREIGN KEY ("granted_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "staff_permission_grants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_permission_grants" FORCE ROW LEVEL SECURITY;
CREATE POLICY "staff_permission_grants_tenant_isolation" ON "staff_permission_grants"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
