-- AN APPOINTMENT THAT ARRIVES BECOMES A VISIT, AND NOTHING RECORDED WHICH.
--
-- `AppointmentService.arrived()` already creates the queue ticket (type A) —
-- and `addToQueue` creates a VISIT to hang it on. The appointment then had no
-- idea which visit it had become, which makes two things impossible:
--
--   1. "Completing the consultation completes the appointment." The only
--      completion path is `VisitCompletionService.completeVisit(visitId)`, and
--      it had no way to find the appointment that started it. Appointments
--      therefore sat at ARRIVED forever and the Completed tab stayed empty.
--   2. Opening the record from the calendar's detail panel. The panel knew the
--      patient but not the visit, so "open record" could only guess at the
--      most recent one — which is the wrong visit the moment a patient has two.
--
-- UNIQUE: one appointment becomes at most one visit, and a visit is the
-- outcome of at most one appointment. A walk-in visit simply has no row
-- pointing at it, which is the normal case and why this is nullable.
--
-- ON DELETE SET NULL rather than CASCADE: a visit is a medical record. If one
-- were ever removed, the appointment that led to it is still a fact about the
-- diary and must not vanish with it.

ALTER TABLE "appointments" ADD COLUMN "visit_id" TEXT;

CREATE UNIQUE INDEX "appointments_visit_id_key" ON "appointments"("visit_id");

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_visit_id_fkey"
  FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- A CANCELLATION NAMES WHO, NOT ONLY WHY.
--
-- `cancel_reason` has been there since the module was written. The person is
-- the half that matters when a patient rings back asking why their appointment
-- was cancelled: a reason with nobody's name on it cannot be followed up.
--
-- Same shape as every other attribution in this system, and NOT backfilled —
-- no cancellation made before today has an author anybody can name, and
-- writing the current user onto them would invent one.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "appointments"
  ADD COLUMN "cancelled_by_staff_id" TEXT,
  ADD COLUMN "cancelled_at" TIMESTAMP(3);

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_cancelled_by_staff_id_fkey"
  FOREIGN KEY ("cancelled_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
