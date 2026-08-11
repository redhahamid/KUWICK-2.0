-- S3c (D-082) — registration and attendance are two different facts.
--
-- `visits.staff_id` was NOT NULL, so a walk-in that nobody had been assigned
-- to yet still had to name somebody. Front desk put THEMSELVES there, and the
-- column stopped being able to distinguish:
--
--   "Dr Amira is seeing this patient"      (clinical)
--   "Amy at the counter typed this in"     (administrative)
--
-- Two changes, both additive in effect:
--   1. staff_id becomes NULLABLE — "no clinician has taken this visit" is now
--      representable instead of being faked.
--   2. registered_by_staff_id records who created the visit.
--
-- NOTHING EXISTING IS REWRITTEN. Every current staff_id keeps its value, and
-- no row is made unassigned by this migration. A historical staff_id may be a
-- genuine attending clinician or a registrar stored under the old constraint,
-- and there is no reliable way to tell which — so it is left exactly as found
-- rather than guessed at.
--
-- registered_by_staff_id is left NULL everywhere. Kuwick stores no separate
-- record of who created a visit, so there is nothing to backfill FROM;
-- copying staff_id into it would manufacture an attribution that was never
-- captured. NULL means "registration attribution was not captured".
--
-- ROLLBACK LIMITATION: reverting staff_id to NOT NULL is only safe while no
-- row has yet been created with a NULL attending clinician. Once the new
-- walk-in path is in use, a down-migration would have to invent a value for
-- every unassigned visit — which is the exact fabrication this change exists
-- to stop. Dropping registered_by_staff_id is clean at any time.

ALTER TABLE "visits" ALTER COLUMN "staff_id" DROP NOT NULL;

ALTER TABLE "visits" ADD COLUMN "registered_by_staff_id" TEXT;

ALTER TABLE "visits"
  ADD CONSTRAINT "visits_registered_by_staff_id_fkey"
  FOREIGN KEY ("registered_by_staff_id") REFERENCES "staff"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- SET NULL rather than RESTRICT: registration provenance is administrative,
-- not a clinical record, so it must not block removing a staff row. Clinical
-- authorship keeps its own snapshots and is unaffected either way.

-- "Which visits are waiting for a doctor" is a queue question asked constantly
-- and answered by very few rows, so it gets a partial index rather than a
-- full one.
CREATE INDEX "visits_tenant_clinic_unassigned_idx"
  ON "visits" ("tenant_id", "clinic_id", "check_in_at")
  WHERE "staff_id" IS NULL;

CREATE INDEX "visits_tenant_registered_by_idx"
  ON "visits" ("tenant_id", "registered_by_staff_id")
  WHERE "registered_by_staff_id" IS NOT NULL;
