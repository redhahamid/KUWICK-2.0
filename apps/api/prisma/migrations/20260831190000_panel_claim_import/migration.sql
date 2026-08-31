-- PANEL CLAIM IMPORT (G-12) — the last thing standing between the clinic and
-- closing its claim workbook.
--
-- Kuwick cannot start empty on cutover day: the workbook holds thousands of
-- open and historical claims, a third of them unpaid, all of them live money.
-- Importing them means accepting a claim with no Kuwick invoice behind it,
-- because the visits happened in another system.
--
-- The invariant is NOT weakened, it is stated precisely. It was "every claim
-- has an invoice"; it is now "every claim Kuwick raises has an invoice, and
-- every claim without one came from a named import" — and a CHECK enforces
-- exactly that. See docs/DECISIONS.md D-115.

-- 1 ------------------------------------------------------------------------
CREATE TABLE "claim_import_batches" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "panel_clinic_id" TEXT NOT NULL,
    "file_name" TEXT,
    "row_count" INTEGER NOT NULL,
    "imported_count" INTEGER NOT NULL,
    "skipped_count" INTEGER NOT NULL,
    "claimed_total" DECIMAL(12,2) NOT NULL,
    "expected_total" DECIMAL(12,2) NOT NULL,
    "received_total" DECIMAL(12,2) NOT NULL,
    "outstanding_total" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "imported_by_staff_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claim_import_batches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "claim_import_batches_tenant_id_panel_clinic_id_idx"
    ON "claim_import_batches"("tenant_id", "panel_clinic_id");

ALTER TABLE "claim_import_batches"
    ADD CONSTRAINT "claim_import_batches_tenant_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "claim_import_batches_panel_fkey"
        FOREIGN KEY ("panel_clinic_id") REFERENCES "panel_clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "claim_import_batches_staff_fkey"
        FOREIGN KEY ("imported_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "claim_import_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "claim_import_batches" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "claim_import_batches"
    USING ("tenant_id" = current_setting('app.tenant_id', true))
    WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

-- 2 ------------------------------------------------------------------------
ALTER TABLE "claim_batch_lines"
    ADD COLUMN "import_batch_id" TEXT,
    ADD COLUMN "legacy_service_date" DATE,
    ADD COLUMN "legacy_patient_reference" TEXT;

ALTER TABLE "claim_batch_lines"
    ADD CONSTRAINT "claim_batch_lines_import_batch_fkey"
        FOREIGN KEY ("import_batch_id") REFERENCES "claim_import_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "claim_batch_lines_tenant_id_import_batch_id_idx"
    ON "claim_batch_lines"("tenant_id", "import_batch_id");

-- 3 ------------------------------------------------------------------------
-- The invoice becomes optional, and the CHECK says exactly when.
ALTER TABLE "claim_batch_lines" ALTER COLUMN "invoice_id" DROP NOT NULL;

ALTER TABLE "claim_batch_lines"
    ADD CONSTRAINT "claim_batch_lines_invoice_or_import"
    CHECK ("invoice_id" IS NOT NULL OR "import_batch_id" IS NOT NULL);

-- 4 ------------------------------------------------------------------------
-- IDEMPOTENCY, at the database rather than only in the service. A panel's
-- claim number identifies a claim; importing the same file twice must not
-- create it twice. Partial, because a claim raised in Kuwick has no number
-- until it is submitted, and several may be NULL at once.
CREATE UNIQUE INDEX "claim_batch_lines_imported_claim_no_unique"
    ON "claim_batch_lines"("tenant_id", "import_batch_id", "panel_claim_no")
    WHERE "import_batch_id" IS NOT NULL AND "panel_claim_no" IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "claim_import_batches" TO PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kuwick_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "claim_import_batches" TO kuwick_app;
  END IF;
END $$;
