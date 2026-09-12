-- PIECE 3g — WHAT THE PORTAL HANDS IN, AND WHERE A PUNCH CAME FROM.
--
-- Clock in from the portal (phase 1) records the punch with a selfie kept as
-- proof (not recognition), the phone's position, and whether that position
-- was inside the branch's radius. The columns are shaped so a QR at the door
-- (phase 2) and a device import (phase 3) land without changing them.
--
-- The geofence lives on the attendance policy: the branch's point and a
-- radius, 150 m unless changed. No point recorded means nothing is checked.
-- Consent to the selfie is asked once and dated on the employee profile.
--
-- A leave request can carry the MC the policy asks for; a mileage claim
-- carries the kilometres and the rate it was priced at, frozen there so a
-- later change to the clinic's rate never reprices an old claim; the rate
-- itself lives on claim_policies, one row per clinic.
--
-- Bytes for all three — receipt, MC, selfie — go in staff_files, served only
-- to the person and to HR. They are not media assets: those are public-page
-- images, and a payslip's neighbour must never be reachable by guessing an id.
--
-- NO BACKFILL. Existing punches read PORTAL with no proof, no position and
-- no flag, which is what they were.

CREATE TYPE "AttendanceSource" AS ENUM ('PORTAL', 'QR', 'DEVICE', 'MANUAL');
CREATE TYPE "StaffFileKind" AS ENUM ('RECEIPT', 'MEDICAL_CERTIFICATE', 'SELFIE');

ALTER TABLE "attendance_records"
    ADD COLUMN "source" "AttendanceSource" NOT NULL DEFAULT 'PORTAL',
    ADD COLUMN "proof_url" TEXT,
    ADD COLUMN "clock_out_proof_url" TEXT,
    ADD COLUMN "lat" DECIMAL(9,6),
    ADD COLUMN "lng" DECIMAL(9,6),
    ADD COLUMN "clock_out_lat" DECIMAL(9,6),
    ADD COLUMN "clock_out_lng" DECIMAL(9,6),
    ADD COLUMN "distance_metres" INTEGER,
    ADD COLUMN "outside_clinic" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "attendance_policies"
    ADD COLUMN "geofence_lat" DECIMAL(9,6),
    ADD COLUMN "geofence_lng" DECIMAL(9,6),
    ADD COLUMN "geofence_radius_metres" INTEGER NOT NULL DEFAULT 150;

ALTER TABLE "employee_profiles"
    ADD COLUMN "selfie_consent_at" TIMESTAMP(3);

ALTER TABLE "staff_claims"
    ADD COLUMN "distance_km" DECIMAL(7,1),
    ADD COLUMN "mileage_rate" DECIMAL(6,2);

-- ---------------------------------------------------------------------------
CREATE TABLE "leave_request_attachments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "leave_request_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "uploaded_by_staff_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_request_attachments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "leave_request_attachments_tenant_id_leave_request_id_idx" ON "leave_request_attachments"("tenant_id", "leave_request_id");
ALTER TABLE "leave_request_attachments"
    ADD CONSTRAINT "leave_request_attachments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "leave_request_attachments_leave_request_id_fkey" FOREIGN KEY ("leave_request_id") REFERENCES "leave_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "leave_request_attachments_uploaded_by_staff_id_fkey" FOREIGN KEY ("uploaded_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
CREATE TABLE "claim_policies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "mileage_rate_per_km" DECIMAL(6,2) NOT NULL DEFAULT 0.60,
    "receipt_required" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by_staff_id" TEXT,

    CONSTRAINT "claim_policies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "claim_policies_tenant_id_key" ON "claim_policies"("tenant_id");
ALTER TABLE "claim_policies"
    ADD CONSTRAINT "claim_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "claim_policies_updated_by_staff_id_fkey" FOREIGN KEY ("updated_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
CREATE TABLE "staff_files" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "kind" "StaffFileKind" NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_files_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "staff_files_tenant_id_staff_id_kind_idx" ON "staff_files"("tenant_id", "staff_id", "kind");
ALTER TABLE "staff_files"
    ADD CONSTRAINT "staff_files_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "staff_files_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY — every new table, no exceptions.
-- ---------------------------------------------------------------------------
ALTER TABLE "leave_request_attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_request_attachments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "leave_request_attachments"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "claim_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "claim_policies" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "claim_policies"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "staff_files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_files" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "staff_files"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));
