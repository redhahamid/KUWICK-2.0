-- AN EMPLOYEE ASKING FOR A PUNCH TO BE PUT RIGHT — a request, not an edit.
--
-- `attendance_records` already carries a correction with the original punches
-- beside the new ones, but that is a MANAGER writing. An employee who forgot
-- to clock out had no way to say so, and handing them the manager's write
-- would make the person whose pay depends on the number the person who sets
-- it. This is the ask; approving one still applies the correction through the
-- ordinary path, so attendance history is rewritten in exactly one way.

CREATE TYPE "AttendanceCorrectionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

CREATE TABLE "attendance_correction_requests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "attendance_record_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,

    "requested_clock_in_at" TIMESTAMP(3),
    "requested_clock_out_at" TIMESTAMP(3),
    "reason" TEXT NOT NULL,

    "status" "AttendanceCorrectionStatus" NOT NULL DEFAULT 'PENDING',

    "decided_by_staff_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,

    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_correction_requests_pkey" PRIMARY KEY ("id")
);

-- "My requests" and "the queue" are the two reads this table exists for.
CREATE INDEX "attendance_correction_requests_tenant_staff_status_idx"
    ON "attendance_correction_requests"("tenant_id", "staff_id", "status");
CREATE INDEX "attendance_correction_requests_tenant_status_idx"
    ON "attendance_correction_requests"("tenant_id", "status");
CREATE INDEX "attendance_correction_requests_tenant_record_idx"
    ON "attendance_correction_requests"("tenant_id", "attendance_record_id");

-- ONE PENDING REQUEST PER RECORD. Two open asks about the same day are two
-- answers waiting to contradict each other; a decided one does not block a
-- fresh ask, which is why the index is partial rather than a plain unique.
CREATE UNIQUE INDEX "attendance_correction_requests_one_pending_per_record"
    ON "attendance_correction_requests"("attendance_record_id") WHERE "status" = 'PENDING';

ALTER TABLE "attendance_correction_requests" ADD CONSTRAINT "attendance_correction_requests_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_correction_requests" ADD CONSTRAINT "attendance_correction_requests_record_fkey"
    FOREIGN KEY ("attendance_record_id") REFERENCES "attendance_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_correction_requests" ADD CONSTRAINT "attendance_correction_requests_staff_id_fkey"
    FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_correction_requests" ADD CONSTRAINT "attendance_correction_requests_decided_by_fkey"
    FOREIGN KEY ("decided_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ROW-LEVEL SECURITY. Same shape as every other tenant-scoped table.
ALTER TABLE "attendance_correction_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_correction_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "attendance_correction_requests"
    USING (tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kuwick_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "attendance_correction_requests" TO kuwick_app;
  END IF;
END $$;
