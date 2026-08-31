-- G-6: why a panel refused to pay, as a countable fact beside the sentence.
-- Read off the clinic's own excess/rejected register; see
-- docs/PANEL_LEGACY_WORKFLOW_AUDIT.md §8.3.
--
-- Nullable with no backfill: a claim rejected before this existed genuinely has
-- no category, and defaulting it to OTHER would invent data on a report.
CREATE TYPE "ClaimRejectionCategory" AS ENUM (
  'PATIENT_LIMIT_EXHAUSTED',
  'ITEM_NOT_COVERED',
  'PARTIALLY_COVERED',
  'BENEFIT_SUBLIMIT',
  'AUTHORISATION_PENDING',
  'DOCUMENTATION_INCOMPLETE',
  'OTHER'
);

ALTER TABLE "claim_batch_lines" ADD COLUMN "rejection_category" "ClaimRejectionCategory";
