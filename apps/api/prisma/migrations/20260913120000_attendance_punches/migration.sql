-- EVERY PRESS OF THE BUTTON, KEPT.
--
-- `attendance_records` holds one clock-in and one clock-out a day. A clinic
-- whose admin staff clock out at lunch and back in — deliberately, so the
-- owner can see who left and came back late — had the two middle punches
-- overwritten and lost, and the lunch hour counted as worked. Clocking in
-- writes no audit row either, so nothing anywhere could recover them.
--
-- The daily record STAYS as the computed summary every screen and the payroll
-- engine already read. This adds the punches underneath it.
--
-- APPEND-ONLY: a punch is never updated and never deleted. A correction writes
-- new punches and marks the ones it replaces superseded, with who and why.

CREATE TYPE "AttendancePunchKind" AS ENUM ('IN', 'OUT');

CREATE TABLE "attendance_punches" (
    "id"                     TEXT NOT NULL,
    "tenant_id"              TEXT NOT NULL,
    "attendance_record_id"   TEXT NOT NULL,
    "staff_id"               TEXT NOT NULL,
    "at"                     TIMESTAMP(3) NOT NULL,
    "kind"                   "AttendancePunchKind" NOT NULL,
    "source"                 "AttendanceSource" NOT NULL DEFAULT 'PORTAL',
    "proof_url"              TEXT,
    "lat"                    DECIMAL(9,6),
    "lng"                    DECIMAL(9,6),
    "distance_metres"        INTEGER,
    "outside_clinic"         BOOLEAN NOT NULL DEFAULT false,
    "superseded_at"          TIMESTAMP(3),
    "superseded_by_staff_id" TEXT,
    "superseded_reason"      TEXT,
    "recorded_by_staff_id"   TEXT,
    "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_punches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "attendance_punches_tenant_id_attendance_record_id_at_idx"
    ON "attendance_punches"("tenant_id", "attendance_record_id", "at");
CREATE INDEX "attendance_punches_tenant_id_staff_id_at_idx"
    ON "attendance_punches"("tenant_id", "staff_id", "at");

ALTER TABLE "attendance_punches"
    ADD CONSTRAINT "attendance_punches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "attendance_punches_attendance_record_id_fkey" FOREIGN KEY ("attendance_record_id") REFERENCES "attendance_records"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "attendance_punches_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "attendance_punches_superseded_by_staff_id_fkey" FOREIGN KEY ("superseded_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "attendance_punches_recorded_by_staff_id_fkey" FOREIGN KEY ("recorded_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A superseding decision is a fact with an author and a reason, or it is not a
-- decision. Enforced in the data, not only in the service that writes it.
ALTER TABLE "attendance_punches"
    ADD CONSTRAINT "attendance_punches_superseded_is_whole"
    CHECK (
      ("superseded_at" IS NULL AND "superseded_by_staff_id" IS NULL AND "superseded_reason" IS NULL)
      OR ("superseded_at" IS NOT NULL AND "superseded_by_staff_id" IS NOT NULL AND "superseded_reason" IS NOT NULL)
    );

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY, like every other tenant table.
ALTER TABLE "attendance_punches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_punches" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "attendance_punches"
  USING (
    tenant_id = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_tenant_scope', true) = 'true'
  );

-- ---------------------------------------------------------------------------
-- BACKFILL — one IN and one OUT for every day already recorded.
--
-- After this, every historical day reads EXACTLY as it did: a day with one
-- clock-in and one clock-out is one closed pair, and the sum of one pair is
-- the span between them. That identity is what makes this migration safe to
-- run against a database whose figures somebody has already reconciled.
--
-- `recorded_by_staff_id` is left NULL: the old record does not say who pressed
-- the button, and inventing an actor for a historical punch would be worse
-- than admitting the record never held one. `source` comes from the record,
-- which carried the clock-in's source for the whole day.
--
-- `distance_metres` and `outside_clinic` stay NULL and false on backfilled
-- punches ON PURPOSE. The record's own values are a DAY-level fact — the
-- furthest punch of that day — so attributing them to either punch would state
-- something the old row never knew. The record keeps them for historical days;
-- new punches carry their own.
INSERT INTO "attendance_punches" (
  "id", "tenant_id", "attendance_record_id", "staff_id", "at", "kind",
  "source", "proof_url", "lat", "lng", "created_at"
)
SELECT
  gen_random_uuid()::text, r."tenant_id", r."id", r."staff_id", r."clock_in_at", 'IN',
  r."source", r."proof_url", r."lat", r."lng", r."created_at"
FROM "attendance_records" r
WHERE r."clock_in_at" IS NOT NULL;

INSERT INTO "attendance_punches" (
  "id", "tenant_id", "attendance_record_id", "staff_id", "at", "kind",
  "source", "proof_url", "lat", "lng", "created_at"
)
SELECT
  gen_random_uuid()::text, r."tenant_id", r."id", r."staff_id", r."clock_out_at", 'OUT',
  r."source", r."clock_out_proof_url", r."clock_out_lat", r."clock_out_lng", r."created_at"
FROM "attendance_records" r
WHERE r."clock_out_at" IS NOT NULL;
