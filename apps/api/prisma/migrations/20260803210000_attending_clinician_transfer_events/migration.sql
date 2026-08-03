-- S3b (D-081) — attending-clinician assignment and transfer leaves a record.
--
-- Additive only. No existing row is touched, and nothing here changes who
-- authored any existing clinical record.
--
-- ROLLBACK LIMITATION: as in D-080, PostgreSQL cannot DROP an enum value, so
-- ATTENDING_CLINICIAN_CHANGED cannot be removed once added. The two columns
-- below CAN be dropped cleanly.

ALTER TYPE "VisitWorkflowEventType" ADD VALUE IF NOT EXISTS 'ATTENDING_CLINICIAN_CHANGED';

-- Who held the visit before, and who holds it now.
--
-- Typed columns rather than a corner of `metadata`, for the same reason the
-- status columns are typed: "every visit Dr A handed over last month" is an
-- ordinary indexed query, and a handover record that can only be read by
-- JSON extraction is a record nobody will read.
ALTER TABLE "visit_workflow_events"
  ADD COLUMN "previous_staff_id" TEXT,
  ADD COLUMN "new_staff_id"      TEXT;

ALTER TABLE "visit_workflow_events"
  ADD CONSTRAINT "visit_workflow_events_previous_staff_id_fkey"
    FOREIGN KEY ("previous_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "visit_workflow_events_new_staff_id_fkey"
    FOREIGN KEY ("new_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RESTRICT, not SET NULL: a handover record whose doctors have been erased is
-- not a handover record. Same append-only guarantee as the visit and actor
-- references.

CREATE INDEX "visit_workflow_events_tenant_prev_staff_idx"
  ON "visit_workflow_events" ("tenant_id", "previous_staff_id", "created_at")
  WHERE "previous_staff_id" IS NOT NULL;
CREATE INDEX "visit_workflow_events_tenant_new_staff_idx"
  ON "visit_workflow_events" ("tenant_id", "new_staff_id", "created_at")
  WHERE "new_staff_id" IS NOT NULL;
