-- Panel control model: the fee direction, the payment-term shape, and the
-- re-claim window. See docs/PANEL_LEGACY_WORKFLOW_AUDIT.md (P-1, G-1, G-2, G-4).
--
-- Every column is NULLABLE with no backfill, deliberately: NULL means "nobody
-- has said", and the receivable calculation treats an unknown fee direction as
-- unresolved rather than picking a sign.

CREATE TYPE "PanelFeeDirection" AS ENUM ('ADDED', 'WITHHELD');
CREATE TYPE "PanelTermUnit" AS ENUM ('CALENDAR_DAYS', 'WORKING_DAYS');
CREATE TYPE "PanelTermAnchor" AS ENUM ('SERVICE_DATE', 'SUBMISSION_DATE', 'INVOICE_DATE');

ALTER TABLE "panel_clinics"
  ADD COLUMN "fee_direction" "PanelFeeDirection",
  ADD COLUMN "payment_term_max_days" INTEGER,
  ADD COLUMN "payment_term_unit" "PanelTermUnit",
  ADD COLUMN "payment_term_anchor" "PanelTermAnchor",
  ADD COLUMN "payment_term_varies_by_payer" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "resubmission_window_days" INTEGER;

-- The direction is SNAPSHOTTED onto the claim, like claimed_amount and
-- fee_amount already are: a configuration change must never rewrite a claim
-- that has already been sent. Existing rows stay NULL — unresolved, and
-- visibly so — rather than being backfilled with a guess.
ALTER TABLE "claim_batch_lines" ADD COLUMN "fee_direction" "PanelFeeDirection";
