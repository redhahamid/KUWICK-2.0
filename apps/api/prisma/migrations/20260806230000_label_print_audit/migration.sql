-- G4.5d5b-2 — the medication-label audit trail.
--
-- Drug labels were assembled entirely in the browser and left no record at
-- all, so a clinic could not answer "was this label printed, and by whom".
-- This is the smallest table that answers it: the ACT of printing, never a
-- second copy of the patient's medication. Label content is re-assembled from
-- the live prescription each time, so this table cannot drift from the
-- clinical record.
--
-- Printing is not dispensing: nothing here moves stock or changes a
-- prescription, a queue ticket or an invoice.

CREATE TABLE "label_prints" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "prescription_id" TEXT NOT NULL,
    "printed_by_staff_id" TEXT NOT NULL,
    "printer_name_snapshot" TEXT NOT NULL,
    "printed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "copies" INTEGER NOT NULL DEFAULT 1,
    "print_sequence" INTEGER NOT NULL,
    "is_reprint" BOOLEAN NOT NULL DEFAULT false,
    "label_format" TEXT NOT NULL DEFAULT 'KUWICK_STD_70x40',

    CONSTRAINT "label_prints_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "label_prints_tenant_id_prescription_id_idx"
  ON "label_prints"("tenant_id", "prescription_id");
CREATE INDEX "label_prints_tenant_id_clinic_id_printed_at_idx"
  ON "label_prints"("tenant_id", "clinic_id", "printed_at");

ALTER TABLE "label_prints" ADD CONSTRAINT "label_prints_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "label_prints" ADD CONSTRAINT "label_prints_clinic_id_fkey"
  FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "label_prints" ADD CONSTRAINT "label_prints_prescription_id_fkey"
  FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "label_prints" ADD CONSTRAINT "label_prints_printed_by_staff_id_fkey"
  FOREIGN KEY ("printed_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A print sequence is unique within a prescription, so two concurrent prints
-- cannot both claim to be the first. The service allocates it inside the same
-- transaction as the insert; this constraint is what makes that claim safe
-- rather than merely likely.
CREATE UNIQUE INDEX "label_prints_prescription_id_print_sequence_key"
  ON "label_prints"("prescription_id", "print_sequence");

-- Copies are a physical count, not an integer field: 1–3 is the approved
-- range and the database refuses anything else even if a caller reaches the
-- table another way.
ALTER TABLE "label_prints" ADD CONSTRAINT "label_prints_copies_range_check"
  CHECK ("copies" >= 1 AND "copies" <= 3);

-- ---------------------------------------------------------------------------
-- RLS — the same tenant_isolation shape as every other tenant-scoped table.
-- ---------------------------------------------------------------------------
ALTER TABLE "label_prints" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "label_prints" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "label_prints";
CREATE POLICY tenant_isolation ON "label_prints"
  USING (tenant_id = current_setting('app.tenant_id', true));

-- Append-only, like the workflow events: an audit row that can be deleted is
-- not an audit row. No DELETE grant is issued.
GRANT SELECT, INSERT ON "label_prints" TO PUBLIC;

-- G4.5d5b-2 — why a stock movement happened, when it needs saying.
--
-- One specific fact the approved dispensing policy produces: a hand-over made
-- under an ACKNOWLEDGED stock shortage. The policy permits it, so the ledger
-- must be able to record that the shortage was seen and accepted rather than
-- leaving an unexplained negative balance for someone to find later.
ALTER TABLE "stock_movements" ADD COLUMN "notes" TEXT;
