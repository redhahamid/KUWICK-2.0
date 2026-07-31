-- Panel workbook upgrade (D-041), built to the owner's real claim-tracking
-- workbook (docs/PROPOSED_ADDENDUM_2026-08-01_panel-claim-listing-reference.md):
-- per-panel payment terms, per-claim add-on fee + remarks, and re-claimable
-- invoices for the excess/rejected resubmission workflow.

-- AlterTable
ALTER TABLE "panel_clinics" ADD COLUMN "payment_term_days" INTEGER;

ALTER TABLE "claim_batch_lines" ADD COLUMN "fee_amount" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "claim_batch_lines" ADD COLUMN "remarks" TEXT;

-- An invoice may now be claimed more than once over time (a rejected/short
-- claim gets resubmitted as a new claim); the one-ACTIVE-line rule moves to
-- the service layer.
DROP INDEX "claim_batch_lines_invoice_id_key";
CREATE INDEX "claim_batch_lines_tenant_id_invoice_id_idx" ON "claim_batch_lines"("tenant_id", "invoice_id");
