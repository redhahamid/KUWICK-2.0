-- §18b — EFFECTIVE-DATED PROVIDER SCHEDULING MODE.
--
-- `staff.appointment_schedule_mode` is a single value and therefore a single
-- moment: flipping it re-interprets every date at once, and "weekly from
-- 1 September" was impossible without a background job to flip the flag on
-- the day. This table records mode DECISIONS instead; the mode governing any
-- date is the latest row whose effective_from is on or before it. A provider
-- with no rows falls back to the legacy column — deliberately NOT backfilled,
-- because inventing an effective_from for decisions nobody dated would
-- misrepresent history.
--
-- ADDITIVE ONLY. No existing table, index, row or column is touched. (The
-- auto-generated version of this migration also tried to reconcile long-
-- standing index-name drift on unrelated tables — dropped, deliberately:
-- a migration shipping a feature changes exactly what the feature needs.)

-- CreateTable
CREATE TABLE "provider_schedule_mode_periods" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "mode" "ProviderScheduleMode" NOT NULL,
    "effective_from" DATE NOT NULL,
    "created_by_staff_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_schedule_mode_periods_pkey" PRIMARY KEY ("id")
);

-- The latest-period-on-or-before-a-date lookup, and the guarantee that one
-- provider can never hold two decisions for the same day.
CREATE INDEX "provider_schedule_mode_periods_tenant_id_staff_id_effective_idx"
  ON "provider_schedule_mode_periods"("tenant_id", "staff_id", "effective_from" DESC);
CREATE UNIQUE INDEX "provider_schedule_mode_periods_tenant_id_staff_id_effective_key"
  ON "provider_schedule_mode_periods"("tenant_id", "staff_id", "effective_from");

-- AddForeignKey
ALTER TABLE "provider_schedule_mode_periods" ADD CONSTRAINT "provider_schedule_mode_periods_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_schedule_mode_periods" ADD CONSTRAINT "provider_schedule_mode_periods_clinic_id_fkey"
  FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_schedule_mode_periods" ADD CONSTRAINT "provider_schedule_mode_periods_staff_id_fkey"
  FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "provider_schedule_mode_periods" ADD CONSTRAINT "provider_schedule_mode_periods_created_by_staff_id_fkey"
  FOREIGN KEY ("created_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-Level Security — same shape as every tenant-scoped table (see the
-- force_rls_core_foundation migration for why both ENABLE and FORCE).
ALTER TABLE "provider_schedule_mode_periods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "provider_schedule_mode_periods" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "provider_schedule_mode_periods"
  USING (tenant_id = current_setting('app.tenant_id', true));

-- HISTORY IS IMMUTABLE AT THE DATABASE. A period that has started governing
-- real days (effective_from before today) can never be rewritten or removed,
-- by anyone the policies let in at all — re-deciding the past would silently
-- change what every historical availability answer meant. A today-or-future
-- period stays editable: withdrawing or re-deciding a change before it takes
-- effect is a correction, not a rewrite, and the unique key above already
-- forbids two decisions for the same day.
CREATE OR REPLACE FUNCTION refuse_past_schedule_mode_rewrite() RETURNS trigger AS $$
BEGIN
  IF OLD.effective_from < CURRENT_DATE THEN
    RAISE EXCEPTION 'schedule-mode history is append-only: the period effective % already governed past days and cannot be % ', OLD.effective_from, lower(TG_OP);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER provider_schedule_mode_periods_append_only
  BEFORE UPDATE OR DELETE ON "provider_schedule_mode_periods"
  FOR EACH ROW EXECUTE FUNCTION refuse_past_schedule_mode_rewrite();
