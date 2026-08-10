-- KW2-C2 — Copy Rx: where a prescription came from, and whether it has been
-- looked at since.
--
-- Copying a previous visit's medication is a NEW prescribing decision made
-- from old information. The patient's weight, allergies and the clinic's stock
-- have all had time to change. `review_flag` marks the row as "carried over,
-- not yet re-read", and `source_visit_id` records what it was carried from so
-- the claim can be checked rather than taken on trust.
ALTER TABLE "prescriptions" ADD COLUMN "source_visit_id" TEXT;
ALTER TABLE "prescriptions" ADD COLUMN "review_flag" BOOLEAN NOT NULL DEFAULT false;

-- ON DELETE SET NULL, not RESTRICT: a source visit disappearing must never
-- make today's prescription undeletable or unreadable. Losing the provenance
-- is acceptable; losing the prescription is not.
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_source_visit_id_fkey"
  FOREIGN KEY ("source_visit_id") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A review flag is meaningless on a row nobody copied. This stops the flag
-- being set on an ordinary prescription, where it would produce a completion
-- warning about a medication that was never carried over from anywhere.
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_review_flag_requires_source" CHECK (
  "review_flag" = false OR "source_visit_id" IS NOT NULL
);

-- The completion check asks one question per visit: "does anything here still
-- need reviewing?". Indexed so it stays cheap on a busy visit.
CREATE INDEX "prescriptions_review_flag_idx"
  ON "prescriptions"("tenant_id", "visit_id", "review_flag");
