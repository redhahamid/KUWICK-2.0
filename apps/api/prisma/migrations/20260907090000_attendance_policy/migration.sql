-- HOW A CLINIC MEASURES ATTENDANCE — grace, overtime and breaks.
--
-- These lived as five constants in `attendance-hours.ts`, so every clinic in
-- every tenant shared one grace period. A twenty-four-hour clinic with a
-- rotating night shift and a nine-to-five family practice do not agree about
-- when 09:06 is late, and neither of them is wrong.
--
-- Scoped to the CLINIC, because attendance is measured where a person
-- physically works. `clinic_id` NULL is the tenant default, used by any clinic
-- without a row of its own, so a group configures once and overrides only
-- where practice differs.
--
-- NO BACKFILL and no rows created here. Every clinic starts on the built-in
-- defaults, which are the constants that were in the code yesterday — so this
-- migration changes no computed attendance anywhere.

CREATE TABLE "attendance_policies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "clinic_id" TEXT,

    "late_grace_minutes" INTEGER NOT NULL DEFAULT 5,
    "early_out_grace_minutes" INTEGER NOT NULL DEFAULT 5,

    "overtime_minimum_minutes" INTEGER NOT NULL DEFAULT 30,
    "overtime_rounding_minutes" INTEGER NOT NULL DEFAULT 15,
    "overtime_requires_approval" BOOLEAN NOT NULL DEFAULT true,
    "count_early_clock_in" BOOLEAN NOT NULL DEFAULT false,

    "unpaid_break_minutes" INTEGER NOT NULL DEFAULT 0,
    "break_after_minutes" INTEGER NOT NULL DEFAULT 360,

    "maximum_shift_hours" INTEGER NOT NULL DEFAULT 16,

    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by_staff_id" TEXT,

    CONSTRAINT "attendance_policies_pkey" PRIMARY KEY ("id")
);

-- One policy per clinic, and one tenant default (clinic_id NULL). Postgres
-- treats NULLs as distinct in a unique index, so the default row needs the
-- partial index below to stay singular.
CREATE UNIQUE INDEX "attendance_policies_tenant_id_clinic_id_key"
    ON "attendance_policies"("tenant_id", "clinic_id");
CREATE UNIQUE INDEX "attendance_policies_tenant_default_key"
    ON "attendance_policies"("tenant_id") WHERE "clinic_id" IS NULL;

ALTER TABLE "attendance_policies" ADD CONSTRAINT "attendance_policies_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_policies" ADD CONSTRAINT "attendance_policies_clinic_id_fkey"
    FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_policies" ADD CONSTRAINT "attendance_policies_updated_by_staff_id_fkey"
    FOREIGN KEY ("updated_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ROW-LEVEL SECURITY. Same shape as every other tenant-scoped table: the app
-- role is not a superuser and reads nothing outside its tenant.
ALTER TABLE "attendance_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_policies" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "attendance_policies"
    USING (tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kuwick_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "attendance_policies" TO kuwick_app;
  END IF;
END $$;
