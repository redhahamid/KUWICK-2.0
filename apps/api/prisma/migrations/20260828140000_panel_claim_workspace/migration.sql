-- ===========================================================================
-- ADMIN PROGRAMME — WAVE 3: THE PANEL CLAIM WORKSPACE
--
-- Additive only. `claim_batch_lines.status` (the existing ClaimLineStatus)
-- keeps every value it has and every reader keeps working; `claim_status` is
-- the richer lifecycle beside it, defaulted to BATCHED so existing rows are
-- described correctly rather than guessed at.
--
-- WHAT THIS DOES NOT ADD: portal submission. No panel in the owner's list
-- exposes an API to Kuwick (D-031). Staff still key claims into each portal by
-- hand. What changes is that they know which claims, that the claims are
-- complete before they start, and that what comes back reconciles.
-- ===========================================================================


-- CreateEnum
CREATE TYPE "PanelClaimStatus" AS ENUM ('READY', 'NEEDS_INFORMATION', 'BATCHED', 'SUBMITTED', 'ACKNOWLEDGED', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'RESUBMISSION_REQUIRED', 'RESUBMITTED', 'PAID', 'PARTIALLY_PAID', 'WRITTEN_OFF', 'CLOSED');

-- CreateEnum
CREATE TYPE "PanelSubmissionMethod" AS ENUM ('PORTAL', 'EMAIL', 'COURIER', 'IN_PERSON', 'OTHER');

-- AlterTable
ALTER TABLE "panel_clinics" ADD COLUMN     "account_reference" TEXT,
ADD COLUMN     "claim_number_format" TEXT,
ADD COLUMN     "contact_email" TEXT,
ADD COLUMN     "contact_name" TEXT,
ADD COLUMN     "contact_phone" TEXT,
ADD COLUMN     "document_requirements" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "panel_share_taxable" BOOLEAN,
ADD COLUMN     "payer_name" TEXT,
ADD COLUMN     "portal_url" TEXT,
ADD COLUMN     "requires_itemisation" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "resubmit_as_new_claim" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "submission_method" "PanelSubmissionMethod";

-- AlterTable
ALTER TABLE "claim_batch_lines" ADD COLUMN     "acknowledged_at" TIMESTAMP(3),
ADD COLUMN     "adjudicated_at" TIMESTAMP(3),
ADD COLUMN     "approved_amount" DECIMAL(10,2),
ADD COLUMN     "claim_status" "PanelClaimStatus" NOT NULL DEFAULT 'BATCHED',
ADD COLUMN     "due_date" DATE,
ADD COLUMN     "panel_claim_no" TEXT,
ADD COLUMN     "rejected_amount" DECIMAL(10,2),
ADD COLUMN     "rejection_reason" TEXT,
ADD COLUMN     "resolution_note" TEXT,
ADD COLUMN     "resolved_at" TIMESTAMP(3),
ADD COLUMN     "responsible_staff_id" TEXT,
ADD COLUMN     "submitted_at" TIMESTAMP(3),
ADD COLUMN     "supersedes_line_id" TEXT,
ADD COLUMN     "write_off_reason" TEXT,
ADD COLUMN     "written_off_amount" DECIMAL(10,2),
ADD COLUMN     "written_off_at" TIMESTAMP(3),
ADD COLUMN     "written_off_by_staff_id" TEXT;

-- CreateTable
CREATE TABLE "panel_remittances" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "panel_clinic_id" TEXT NOT NULL,
    "remittance_ref" TEXT,
    "received_at" DATE NOT NULL,
    "gross_amount" DECIMAL(12,2) NOT NULL,
    "withheld_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "recorded_by_staff_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "panel_remittances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "panel_remittance_allocations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "remittance_id" TEXT NOT NULL,
    "claim_batch_line_id" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "panel_remittance_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "claim_batch_line_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "from_status" "PanelClaimStatus",
    "to_status" "PanelClaimStatus",
    "amount" DECIMAL(10,2),
    "reason" TEXT,
    "reference" TEXT,
    "actor_staff_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claim_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "panel_remittances_tenant_id_panel_clinic_id_received_at_idx" ON "panel_remittances"("tenant_id", "panel_clinic_id", "received_at");

-- CreateIndex
CREATE INDEX "panel_remittance_allocations_tenant_id_claim_batch_line_id_idx" ON "panel_remittance_allocations"("tenant_id", "claim_batch_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "panel_remittance_allocations_remittance_id_claim_batch_line_key" ON "panel_remittance_allocations"("remittance_id", "claim_batch_line_id");

-- CreateIndex
CREATE INDEX "claim_events_tenant_id_claim_batch_line_id_created_at_idx" ON "claim_events"("tenant_id", "claim_batch_line_id", "created_at");

-- AddForeignKey
ALTER TABLE "claim_batch_lines" ADD CONSTRAINT "claim_batch_lines_supersedes_line_id_fkey" FOREIGN KEY ("supersedes_line_id") REFERENCES "claim_batch_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_batch_lines" ADD CONSTRAINT "claim_batch_lines_responsible_staff_id_fkey" FOREIGN KEY ("responsible_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_batch_lines" ADD CONSTRAINT "claim_batch_lines_written_off_by_staff_id_fkey" FOREIGN KEY ("written_off_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "panel_remittances" ADD CONSTRAINT "panel_remittances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "panel_remittances" ADD CONSTRAINT "panel_remittances_panel_clinic_id_fkey" FOREIGN KEY ("panel_clinic_id") REFERENCES "panel_clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "panel_remittances" ADD CONSTRAINT "panel_remittances_recorded_by_staff_id_fkey" FOREIGN KEY ("recorded_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "panel_remittance_allocations" ADD CONSTRAINT "panel_remittance_allocations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "panel_remittance_allocations" ADD CONSTRAINT "panel_remittance_allocations_remittance_id_fkey" FOREIGN KEY ("remittance_id") REFERENCES "panel_remittances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "panel_remittance_allocations" ADD CONSTRAINT "panel_remittance_allocations_claim_batch_line_id_fkey" FOREIGN KEY ("claim_batch_line_id") REFERENCES "claim_batch_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_events" ADD CONSTRAINT "claim_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_events" ADD CONSTRAINT "claim_events_claim_batch_line_id_fkey" FOREIGN KEY ("claim_batch_line_id") REFERENCES "claim_batch_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_events" ADD CONSTRAINT "claim_events_actor_staff_id_fkey" FOREIGN KEY ("actor_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- ROW-LEVEL SECURITY.
-- ---------------------------------------------------------------------------
ALTER TABLE "panel_remittances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "panel_remittances" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "panel_remittances"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "panel_remittance_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "panel_remittance_allocations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "panel_remittance_allocations"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "claim_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "claim_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "claim_events"
  USING (tenant_id = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------------
-- A CLAIM'S TIMELINE IS APPEND-ONLY.
--
-- Panel claims are the part of this system most likely to be argued about with
-- an outside party months later. "Who marked this rejected, and when" has to
-- be a question with one answer, and an editable timeline is not one.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_events_append_only() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'claim_events is append-only: a claim''s history is corrected by adding to it, never by editing it';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER claim_events_append_only_trigger
  BEFORE UPDATE OR DELETE ON "claim_events"
  FOR EACH ROW EXECUTE FUNCTION claim_events_append_only();

REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "claim_events" FROM PUBLIC;

-- Money arriving is never negative, and the net must be the gross less what
-- was withheld — a remittance that does not add up should fail loudly at the
-- point somebody types it, not quietly in a reconciliation three weeks later.
ALTER TABLE "panel_remittances" ADD CONSTRAINT panel_remittances_amounts_sane
  CHECK (gross_amount >= 0 AND withheld_amount >= 0 AND net_amount = gross_amount - withheld_amount);

ALTER TABLE "panel_remittance_allocations" ADD CONSTRAINT panel_remittance_allocations_positive
  CHECK (amount > 0);

-- Adjudicated amounts are never negative. A claim the panel refused entirely
-- is approved 0 and rejected the full amount, not approved −108.
ALTER TABLE "claim_batch_lines" ADD CONSTRAINT claim_batch_lines_adjudication_not_negative
  CHECK (
    (approved_amount IS NULL OR approved_amount >= 0)
    AND (rejected_amount IS NULL OR rejected_amount >= 0)
    AND (written_off_amount IS NULL OR written_off_amount >= 0)
  );

-- A claim cannot supersede itself. It is the kind of thing a resubmission bug
-- produces, and it would make the chain a cycle nothing can walk.
ALTER TABLE "claim_batch_lines" ADD CONSTRAINT claim_batch_lines_no_self_supersede
  CHECK (supersedes_line_id IS NULL OR supersedes_line_id <> id);
