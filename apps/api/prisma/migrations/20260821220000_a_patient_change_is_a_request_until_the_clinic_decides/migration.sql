-- PHASE 7 — A PATIENT CHANGE IS A REQUEST UNTIL THE CLINIC DECIDES.
--
-- Until now the manage link offered two worlds only: instant self-service or
-- nothing. The clinic workflow the owner runs needs the third: the patient
-- ASKS, the original appointment stands untouched, and a staff decision is
-- what changes anything.
--
-- Additive only, and no behaviour changes by migration:
--   - the tri-state policies are NULLABLE; NULL falls back to the frozen
--     booleans (true → INSTANT, false → NOT_ALLOWED), so every existing page
--     behaves exactly as yesterday until somebody opens the settings screen;
--   - the request table carries its own tenant RLS (ENABLE + FORCE);
--   - the new event values extend the appointment history vocabulary.

ALTER TYPE "AppointmentEventType" ADD VALUE IF NOT EXISTS 'CHANGE_REQUESTED';
ALTER TYPE "AppointmentEventType" ADD VALUE IF NOT EXISTS 'CHANGE_REQUEST_APPROVED';
ALTER TYPE "AppointmentEventType" ADD VALUE IF NOT EXISTS 'CHANGE_REQUEST_DECLINED';

CREATE TYPE "PatientChangePolicy" AS ENUM ('NOT_ALLOWED', 'REQUEST_APPROVAL', 'INSTANT');
CREATE TYPE "AppointmentChangeRequestType" AS ENUM ('RESCHEDULE', 'CANCELLATION');
CREATE TYPE "AppointmentChangeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'SUPERSEDED');

ALTER TABLE "clinic_booking_pages"
  ADD COLUMN "patient_reschedule_mode" "PatientChangePolicy",
  ADD COLUMN "patient_cancel_mode" "PatientChangePolicy",
  ADD COLUMN "patient_change_cutoff_minutes" INTEGER;

ALTER TABLE "clinic_booking_pages"
  ADD CONSTRAINT "clinic_booking_pages_cutoff_minutes_sane"
  CHECK ("patient_change_cutoff_minutes" IS NULL OR ("patient_change_cutoff_minutes" >= 0 AND "patient_change_cutoff_minutes" <= 43200));

CREATE TABLE "appointment_change_requests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "appointment_id" TEXT NOT NULL,
    "type" "AppointmentChangeRequestType" NOT NULL,
    "status" "AppointmentChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "requested_start" TIMESTAMP(3),
    "requested_end" TIMESTAMP(3),
    "decided_by_staff_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_change_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "appointment_change_requests_tenant_id_clinic_id_status_idx"
    ON "appointment_change_requests"("tenant_id", "clinic_id", "status");

CREATE INDEX "appointment_change_requests_tenant_id_appointment_id_idx"
    ON "appointment_change_requests"("tenant_id", "appointment_id");

-- ONE live question per appointment per type. Partial unique rather than an
-- application check: two browser tabs both submitting land here, and the
-- second is refused by the database however the application races.
CREATE UNIQUE INDEX "appointment_change_requests_one_pending"
    ON "appointment_change_requests"("appointment_id", "type")
    WHERE "status" = 'PENDING';

ALTER TABLE "appointment_change_requests"
    ADD CONSTRAINT "appointment_change_requests_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "appointment_change_requests"
    ADD CONSTRAINT "appointment_change_requests_clinic_id_fkey"
    FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "appointment_change_requests"
    ADD CONSTRAINT "appointment_change_requests_appointment_id_fkey"
    FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "appointment_change_requests"
    ADD CONSTRAINT "appointment_change_requests_decided_by_staff_id_fkey"
    FOREIGN KEY ("decided_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "appointment_change_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "appointment_change_requests" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "appointment_change_requests"
    USING ("tenant_id" = current_setting('app.tenant_id', true));
