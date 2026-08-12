-- A2 — PATIENT ALERTS. Standing, structured facts about a person
-- (MEDICAL | ACCESSIBILITY | COMMUNICATION | ADMINISTRATIVE), visible to the
-- whole team. Deactivation is audited in place; there is deliberately NO
-- DELETE policy below, so under FORCE ROW LEVEL SECURITY a hard delete is
-- refused by PostgreSQL itself — "deactivate, never delete" is a database
-- guarantee, not a convention.

CREATE TYPE "PatientAlertType" AS ENUM ('MEDICAL', 'ACCESSIBILITY', 'COMMUNICATION', 'ADMINISTRATIVE');

CREATE TABLE "patient_alerts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "type" "PatientAlertType" NOT NULL,
    "label" TEXT NOT NULL,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_staff_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivated_by_staff_id" TEXT,
    "deactivated_at" TIMESTAMP(3),

    CONSTRAINT "patient_alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "patient_alerts_tenant_id_patient_id_active_idx"
    ON "patient_alerts"("tenant_id", "patient_id", "active");

ALTER TABLE "patient_alerts"
    ADD CONSTRAINT "patient_alerts_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "patient_alerts"
    ADD CONSTRAINT "patient_alerts_patient_id_fkey"
    FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "patient_alerts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patient_alerts" FORCE ROW LEVEL SECURITY;

CREATE POLICY patient_alert_select ON "patient_alerts"
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY patient_alert_insert ON "patient_alerts"
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- UPDATE exists so deactivation can be recorded. DELETE does not exist at all.
CREATE POLICY patient_alert_update ON "patient_alerts"
  FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
