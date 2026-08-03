-- G4.5d3c-1 (D-080) — additive schema for doctor-phase completion and the
-- operational stations the queue could not previously express.
--
-- ADDITIVE ONLY. Nothing existing is rewritten:
--   * no Visit receives a fabricated doctor-completion value
--   * no historical actor or timestamp is inferred
--   * DISPENSARY_PAYMENT rows keep their status and their meaning
--   * queue_tickets.visit_id stays UNIQUE — one ticket per visit, by owner
--     decision. History is preserved by the append-only event table below,
--     not by giving a visit several tickets.
--
-- ROLLBACK LIMITATION, stated plainly: PostgreSQL cannot DROP a value from an
-- enum type. Reverting the three new QueueTicketStatus values requires
-- recreating the type and rewriting every dependent column, which is not a
-- safe automatic down-migration. The columns and table added here CAN be
-- dropped cleanly; the enum values cannot. Adding an unused enum value is
-- harmless, so the practical rollback is: drop the new columns and table,
-- leave the enum alone.

-- ---------------------------------------------------------------------------
-- 1. Where the patient goes after the doctor finishes.
-- ---------------------------------------------------------------------------
CREATE TYPE "DoctorCompletionDestination" AS ENUM ('DISPENSARY', 'PAYMENT', 'NONE');

-- ---------------------------------------------------------------------------
-- 2. New operational stations.
--
-- ADD VALUE (not a type replacement) so every existing row and every existing
-- query keeps working untouched. Order is cosmetic — the enum's sort order is
-- never relied on for workflow logic, which uses an explicit transition map.
-- ---------------------------------------------------------------------------
ALTER TYPE "QueueTicketStatus" ADD VALUE IF NOT EXISTS 'AT_PROCEDURE';
ALTER TYPE "QueueTicketStatus" ADD VALUE IF NOT EXISTS 'READY_FOR_DISPENSARY';
ALTER TYPE "QueueTicketStatus" ADD VALUE IF NOT EXISTS 'READY_FOR_PAYMENT';

-- ---------------------------------------------------------------------------
-- 3. Visit — the doctor's clinical phase.
--
-- All three nullable, all three left NULL for every existing row. NULL means
-- "doctor-phase completion was not captured", never "it did not happen".
-- There is no DEFAULT and no backfill: a timestamp invented here would be
-- indistinguishable from one the doctor actually recorded.
--
-- These are NOT check_out_at. Completing the doctor phase does not close the
-- visit while downstream work remains.
-- ---------------------------------------------------------------------------
ALTER TABLE "visits"
  ADD COLUMN "doctor_completed_at"          TIMESTAMP(3),
  ADD COLUMN "doctor_completed_by_staff_id" TEXT,
  ADD COLUMN "doctor_completed_destination" "DoctorCompletionDestination";

ALTER TABLE "visits"
  ADD CONSTRAINT "visits_doctor_completed_by_staff_id_fkey"
  FOREIGN KEY ("doctor_completed_by_staff_id") REFERENCES "staff"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Partial index: the overwhelming majority of rows are NULL here, and the
-- question asked of this column is always "which visits HAVE a completed
-- doctor phase".
CREATE INDEX "visits_tenant_doctor_completed_at_idx"
  ON "visits" ("tenant_id", "doctor_completed_at")
  WHERE "doctor_completed_at" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. The append-only operational history.
--
-- AuditLog was inspected first, as required, and rejected: it has no
-- visit_id, clinic_id or queue_ticket_id; its actor is a User, not Staff;
-- it holds no typed previous/new status; it has no relations, so nothing
-- stops a row claiming a visit belonging to another tenant; and it has zero
-- call sites in the codebase. Forcing workflow history into it would produce
-- a log that cannot answer the questions asked of it.
-- ---------------------------------------------------------------------------
CREATE TYPE "VisitWorkflowEventType" AS ENUM (
  'PATIENT_CALLED',
  'CONSULTATION_STARTED',
  'SENT_TO_PROCEDURE',
  'RETURNED_TO_DOCTOR',
  'DOCTOR_PHASE_COMPLETED',
  'SENT_TO_DISPENSARY',
  'DISPENSING_COMPLETED',
  'SENT_TO_PAYMENT',
  'PAYMENT_WORK_COMPLETED',
  'VISIT_COMPLETED',
  'VISIT_CANCELLED'
);

CREATE TABLE "visit_workflow_events" (
  "id"                  TEXT NOT NULL,
  "tenant_id"           TEXT NOT NULL,
  "clinic_id"           TEXT NOT NULL,
  "visit_id"            TEXT NOT NULL,
  "queue_ticket_id"     TEXT,

  "event_type"          "VisitWorkflowEventType" NOT NULL,
  "previous_status"     "QueueTicketStatus",
  "new_status"          "QueueTicketStatus",
  "destination"         "DoctorCompletionDestination",

  -- Identity snapshot: role as plain text at the moment it happened, so a
  -- later promotion cannot rewrite who did what (same principle as C0).
  "actor_staff_id"      TEXT NOT NULL,
  "actor_name_snapshot" TEXT NOT NULL,
  "actor_role_snapshot" TEXT NOT NULL,

  "reason"              TEXT,
  "metadata"            JSONB,
  "correlation_id"      TEXT,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "visit_workflow_events_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "visit_workflow_events"
  ADD CONSTRAINT "visit_workflow_events_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "visit_workflow_events_clinic_id_fkey"
    FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "visit_workflow_events_visit_id_fkey"
    FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "visit_workflow_events_queue_ticket_id_fkey"
    FOREIGN KEY ("queue_ticket_id") REFERENCES "queue_tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "visit_workflow_events_actor_staff_id_fkey"
    FOREIGN KEY ("actor_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ON DELETE RESTRICT on visit, clinic, tenant and actor is the append-only
-- guarantee at the database level: history cannot be erased by deleting the
-- thing it describes. The queue ticket is the one exception — a ticket is
-- operational, not historical, and the event keeps its own copy of the
-- statuses, so losing the ticket does not lose the transition.

-- Idempotency. A retried request carrying the same correlation id writes one
-- event, not two. Scoped to the tenant so one clinic's key cannot collide
-- with another's; NULLs do not participate in a UNIQUE index, so events
-- without a correlation id are unaffected.
CREATE UNIQUE INDEX "visit_workflow_events_tenant_id_correlation_id_key"
  ON "visit_workflow_events" ("tenant_id", "correlation_id");

CREATE INDEX "visit_workflow_events_tenant_visit_created_idx"
  ON "visit_workflow_events" ("tenant_id", "visit_id", "created_at");
CREATE INDEX "visit_workflow_events_tenant_clinic_created_idx"
  ON "visit_workflow_events" ("tenant_id", "clinic_id", "created_at");
CREATE INDEX "visit_workflow_events_tenant_type_created_idx"
  ON "visit_workflow_events" ("tenant_id", "event_type", "created_at");
CREATE INDEX "visit_workflow_events_tenant_actor_created_idx"
  ON "visit_workflow_events" ("tenant_id", "actor_staff_id", "created_at");

-- ---------------------------------------------------------------------------
-- 5. Tenant isolation.
--
-- WITH CHECK as well as USING — USING alone governs what a session can SEE,
-- and would still let a row be INSERTed under another tenant's id. FORCE only
-- after the policy exists, so the table is never left protected-but-policyless.
-- ---------------------------------------------------------------------------
ALTER TABLE "visit_workflow_events" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "visit_workflow_events"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
ALTER TABLE "visit_workflow_events" FORCE ROW LEVEL SECURITY;
