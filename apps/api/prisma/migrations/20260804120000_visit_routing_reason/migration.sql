-- G4.5d3c-2b (D-087) — persist WHY a visit was routed where it was.
--
-- `doctor_completed_destination` records PAYMENT for two different situations:
-- the patient genuinely owes money, and the clinic has not worked out who
-- owes what. READY_FOR_PAYMENT cannot tell them apart either, so after a
-- refresh the screen could only guess — and guessing here means telling a
-- patient they owe money nobody has calculated.
--
-- Option A from the brief: one nullable typed column. Chosen over reading the
-- reason back out of the workflow event because retrieving "the
-- DOCTOR_PHASE_COMPLETED event for this visit" is a query with an ordering
-- assumption baked into it, and a visit that is completed, reopened by a
-- correction and completed again would have two. A column has exactly one
-- value and no retrieval rule to get wrong.
--
-- NOT BACKFILLED. Visits completed before this migration keep NULL, which
-- means "the reason was not captured" — never NO_DOWNSTREAM_WORK. Inferring
-- it now from today's prescriptions and invoices would be exactly the
-- re-derivation this column exists to prevent, and would produce a reason
-- that contradicts where the patient was actually sent.
--
-- ROLLBACK LIMITATION: as in D-080/D-084, PostgreSQL cannot DROP an enum
-- value or a type still referenced by a column. Dropping the COLUMN is clean;
-- dropping "VisitRoutingReason" requires dropping the column first.

CREATE TYPE "VisitRoutingReason" AS ENUM (
  'DISPENSARY_REQUIRED',
  'PATIENT_PAYMENT_REQUIRED',
  'BILLING_REVIEW_REQUIRED',
  'NO_DOWNSTREAM_WORK'
);

ALTER TABLE "visits"
  ADD COLUMN "doctor_completed_routing_reason" "VisitRoutingReason";

-- "Which visits are waiting on a billing review" is the operational question
-- this column exists to answer, and it is answered by few rows.
CREATE INDEX "visits_tenant_routing_reason_idx"
  ON "visits" ("tenant_id", "doctor_completed_routing_reason")
  WHERE "doctor_completed_routing_reason" IS NOT NULL;
