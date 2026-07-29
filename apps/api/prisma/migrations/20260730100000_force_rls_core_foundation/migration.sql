-- Fixes a live tenant-isolation gap: docs/DATABASE_ARCHITECTURE.md §2 documents a
-- tenant_isolation RLS policy on every Core Foundation table, but the init
-- migration never actually created it, and even with a policy present, Postgres
-- exempts a table's OWNER from RLS by default -- the app connects as kuwick_dev,
-- which owns these tables (it ran the migrations), so RLS would silently never
-- apply to the app's own queries without FORCE ROW LEVEL SECURITY.
-- audit_logs is intentionally excluded, per docs/DATABASE_ARCHITECTURE.md §2
-- ("append-only, no read restriction needed beyond RBAC").

ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenants"
  USING (id = current_setting('app.tenant_id', true));

ALTER TABLE "clinics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clinics" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "clinics"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "users"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "user_clinic_access" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_clinic_access" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "user_clinic_access"
  USING (
    EXISTS (
      SELECT 1 FROM "users"
      WHERE "users"."id" = "user_clinic_access"."user_id"
        AND "users"."tenant_id" = current_setting('app.tenant_id', true)
    )
  );

ALTER TABLE "patients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patients" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "patients"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "global_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "global_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "global_settings"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "notification_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "notification_logs"
  USING (tenant_id = current_setting('app.tenant_id', true));
