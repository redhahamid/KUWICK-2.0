-- Phase 1e (Panel Claims Core). Invoice gains snapshotted
-- panelCoveredAmount/patientPaidAmount (computed server-side at pay-time,
-- D-031/D-032 context) so ClaimBatchLine always claims a fixed, historically
-- accurate amount. One claim-batch workflow for every panel; per-panel
-- variance (AIA/MARA/etc.) is captured as data (submission method + free
-- batching cadence), not as a hardcoded workflow fork (D-031).

-- CreateEnum
CREATE TYPE "ClaimBatchStatus" AS ENUM ('BATCHED', 'SUBMITTED', 'PARTIALLY_PAID', 'PAID', 'RECONCILED');
CREATE TYPE "ClaimLineStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'DEDUCTED', 'PAID');

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN "panel_covered_amount" DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE "invoices" ADD COLUMN "patient_paid_amount" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "claim_batches" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "panel_clinic_id" TEXT NOT NULL,
    "batch_number" TEXT NOT NULL,
    "status" "ClaimBatchStatus" NOT NULL DEFAULT 'BATCHED',
    "submission_method" TEXT,
    "submission_reference" TEXT,
    "submitted_at" TIMESTAMP(3),
    "reconciled_at" TIMESTAMP(3),
    "created_by_staff_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "claim_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_batch_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "claim_batch_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "claimed_amount" DECIMAL(10,2) NOT NULL,
    "status" "ClaimLineStatus" NOT NULL DEFAULT 'PENDING',
    "paid_amount" DECIMAL(10,2),
    "deduction_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "claim_batch_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "claim_batches_tenant_id_batch_number_key" ON "claim_batches"("tenant_id", "batch_number");
CREATE INDEX "claim_batches_tenant_id_panel_clinic_id_idx" ON "claim_batches"("tenant_id", "panel_clinic_id");
CREATE UNIQUE INDEX "claim_batch_lines_invoice_id_key" ON "claim_batch_lines"("invoice_id");
CREATE INDEX "claim_batch_lines_tenant_id_claim_batch_id_idx" ON "claim_batch_lines"("tenant_id", "claim_batch_id");

-- AddForeignKey
ALTER TABLE "claim_batches" ADD CONSTRAINT "claim_batches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "claim_batches" ADD CONSTRAINT "claim_batches_panel_clinic_id_fkey" FOREIGN KEY ("panel_clinic_id") REFERENCES "panel_clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "claim_batches" ADD CONSTRAINT "claim_batches_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "claim_batch_lines" ADD CONSTRAINT "claim_batch_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "claim_batch_lines" ADD CONSTRAINT "claim_batch_lines_claim_batch_id_fkey" FOREIGN KEY ("claim_batch_id") REFERENCES "claim_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "claim_batch_lines" ADD CONSTRAINT "claim_batch_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-Level Security (see force_rls_core_foundation migration for why both
-- ENABLE and FORCE are required).
ALTER TABLE "claim_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "claim_batches" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "claim_batches"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "claim_batch_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "claim_batch_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "claim_batch_lines"
  USING (tenant_id = current_setting('app.tenant_id', true));
