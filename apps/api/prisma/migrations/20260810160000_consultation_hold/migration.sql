-- KW2-C2 — HOLD: the doctor pauses a consultation and the patient goes back
-- to the waiting queue, visibly and with an audit trail.
--
-- Until now the Canvas offered a Hold button that did nothing, because the
-- alternative was a silent state change: move the ticket and leave no record
-- of who moved it or why the patient is suddenly waiting again. A queue that
-- reorders itself with no attributable cause is the defect, not the feature.

-- ---------------------------------------------------------------------------
-- 1. The two events.
--
-- CONSULTATION_RESUMED is deliberately NOT a second CONSULTATION_STARTED.
-- That event's createdAt is the consultation's start instant and the
-- consultation tariff reads it: a patient held at 22:40 and taken back at
-- 23:05 must not acquire a late-night fee for a consultation that began
-- before the band. One start per visit, however many pauses.
-- ---------------------------------------------------------------------------
ALTER TYPE "VisitWorkflowEventType" ADD VALUE IF NOT EXISTS 'CONSULTATION_HELD';
ALTER TYPE "VisitWorkflowEventType" ADD VALUE IF NOT EXISTS 'CONSULTATION_RESUMED';

-- ---------------------------------------------------------------------------
-- 2. The CURRENT hold on the ticket.
--
-- The history of every pause lives in visit_workflow_events, which is where
-- history belongs. These two columns exist so the queue board can tell a held
-- patient from an ordinary waiting one inside the indexed read it already
-- does: deriving it from the last event would put a per-row event lookup in
-- the middle of the busiest list in the clinic.
--
-- Both are cleared on resume — they describe the present, not the past.
-- ---------------------------------------------------------------------------
ALTER TABLE "queue_tickets" ADD COLUMN "held_at" TIMESTAMP(3);
ALTER TABLE "queue_tickets" ADD COLUMN "held_by_staff_id" TEXT;

-- RESTRICT, not SET NULL: "on hold · Dr Amira" must not decay into "on hold ·
-- somebody" because a staff row was removed. Staff are deactivated, not
-- erased.
ALTER TABLE "queue_tickets" ADD CONSTRAINT "queue_tickets_held_by_staff_id_fkey"
  FOREIGN KEY ("held_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The two travel together or not at all. A hold time with no doctor behind it
-- would render as an unattributed "on hold", which is precisely the silent
-- state change this whole change exists to prevent.
ALTER TABLE "queue_tickets" ADD CONSTRAINT "queue_tickets_hold_attribution_check" CHECK (
  ("held_at" IS NULL AND "held_by_staff_id" IS NULL)
  OR ("held_at" IS NOT NULL AND "held_by_staff_id" IS NOT NULL)
);

-- The board's query is (tenant, clinic, status) and then "is this one held".
-- Partial, because held tickets are a small minority of the day's rows and an
-- index over the nulls would be mostly dead weight.
CREATE INDEX "queue_tickets_tenant_clinic_held_idx"
  ON "queue_tickets" ("tenant_id", "clinic_id", "held_at")
  WHERE "held_at" IS NOT NULL;
