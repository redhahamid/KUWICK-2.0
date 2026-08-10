-- KW2-C2 — WHO said the carried-over medication had been re-read.
--
-- A clinical acknowledgement with no actor behind it is not an audit trail,
-- it is a boolean. `review_flag` said a row had been checked; it could not say
-- by whom or when, which is exactly what anyone reviewing the record later
-- needs to know.
--
-- A separate migration rather than an edit to the applied one: rewriting a
-- migration that has already run changes its checksum and breaks every
-- environment that deployed it.
ALTER TABLE "prescriptions" ADD COLUMN "reviewed_by_staff_id" TEXT;
ALTER TABLE "prescriptions" ADD COLUMN "reviewed_at" TIMESTAMP(3);

-- RESTRICT, not SET NULL: the staff row behind a clinical acknowledgement
-- must not be deletable out from under it. Staff are deactivated, not erased.
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_reviewed_by_staff_id_fkey"
  FOREIGN KEY ("reviewed_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The two travel together or not at all. A timestamp with no actor, or an
-- actor with no time, is a half-recorded acknowledgement — worse than none,
-- because it looks complete.
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_review_attribution_check" CHECK (
  ("reviewed_by_staff_id" IS NULL AND "reviewed_at" IS NULL)
  OR ("reviewed_by_staff_id" IS NOT NULL AND "reviewed_at" IS NOT NULL)
);
