-- ===========================================================================
-- ADMIN PROGRAMME — WAVE 2: THE STOCK LEDGER
--
-- Additive only. `stock_movements` keeps every row it has; the new movement
-- types are added to the enum and no existing row is re-labelled, because
-- re-labelling a historical ADJUSTMENT as an EXPIRY would be asserting a fact
-- nobody recorded.
--
-- Three workflows become recordable that were not:
--   stock_transfers      two branches, two ends, and a sender who cannot
--                        overwrite what the receiver counted
--   stock_takes          count → review → APPROVE → post, with live stock
--                        untouched until the last step
--   procurement_budgets  a monthly allowance, with actual spend summed from
--                        purchase orders rather than stored beside it
-- ===========================================================================


-- CreateEnum
CREATE TYPE "StockAdjustmentReason" AS ENUM ('OPENING_BALANCE', 'COUNT_CORRECTION', 'DAMAGED', 'EXPIRED', 'WASTAGE', 'RETURN_TO_SUPPLIER', 'RETURN_FROM_PATIENT', 'INTERNAL_USE', 'DATA_ENTRY_ERROR', 'OTHER');

-- CreateEnum
CREATE TYPE "StockTransferStatus" AS ENUM ('DRAFT', 'SENT', 'RECEIVED', 'RECEIVED_WITH_DISCREPANCY', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StockTakeStatus" AS ENUM ('DRAFT', 'COUNTING', 'IN_REVIEW', 'POSTED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockMovementType" ADD VALUE 'TRANSFER_OUT';
ALTER TYPE "StockMovementType" ADD VALUE 'TRANSFER_IN';
ALTER TYPE "StockMovementType" ADD VALUE 'STOCK_TAKE';
ALTER TYPE "StockMovementType" ADD VALUE 'INTERNAL_USE';
ALTER TYPE "StockMovementType" ADD VALUE 'WASTAGE';
ALTER TYPE "StockMovementType" ADD VALUE 'EXPIRY';
ALTER TYPE "StockMovementType" ADD VALUE 'RETURN_TO_SUPPLIER';
ALTER TYPE "StockMovementType" ADD VALUE 'RETURN_FROM_PATIENT';
ALTER TYPE "StockMovementType" ADD VALUE 'OPENING_BALANCE';

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "adjustment_reason" "StockAdjustmentReason",
ADD COLUMN     "created_by_staff_id" TEXT;

-- CreateTable
CREATE TABLE "stock_transfers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "transfer_number" TEXT NOT NULL,
    "from_clinic_id" TEXT NOT NULL,
    "to_clinic_id" TEXT NOT NULL,
    "status" "StockTransferStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "created_by_staff_id" TEXT NOT NULL,
    "sent_by_staff_id" TEXT,
    "sent_at" TIMESTAMP(3),
    "received_by_staff_id" TEXT,
    "received_at" TIMESTAMP(3),
    "cancelled_by_staff_id" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "inter_company" BOOLEAN NOT NULL DEFAULT false,
    "inter_company_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfer_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "transfer_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "quantity_sent" INTEGER NOT NULL,
    "quantity_received" INTEGER,
    "discrepancy_reason" TEXT,
    "unit_cost" DECIMAL(10,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_transfer_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_takes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "take_number" TEXT NOT NULL,
    "status" "StockTakeStatus" NOT NULL DEFAULT 'DRAFT',
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "location" TEXT,
    "created_by_staff_id" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "submitted_by_staff_id" TEXT,
    "reviewed_by_staff_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "posted_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "variance_value" DECIMAL(12,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_takes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_take_assignments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "stock_take_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "location" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_take_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_take_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "stock_take_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "system_quantity" INTEGER NOT NULL,
    "counted_quantity" INTEGER,
    "loose_units" INTEGER,
    "counted_by_staff_id" TEXT,
    "counted_at" TIMESTAMP(3),
    "recount_quantity" INTEGER,
    "recount_at" TIMESTAMP(3),
    "variance_reason" TEXT,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "unit_cost" DECIMAL(10,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_take_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_budgets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "period" DATE NOT NULL,
    "category" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "created_by_staff_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procurement_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_transfers_tenant_id_from_clinic_id_status_idx" ON "stock_transfers"("tenant_id", "from_clinic_id", "status");

-- CreateIndex
CREATE INDEX "stock_transfers_tenant_id_to_clinic_id_status_idx" ON "stock_transfers"("tenant_id", "to_clinic_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_tenant_id_transfer_number_key" ON "stock_transfers"("tenant_id", "transfer_number");

-- CreateIndex
CREATE INDEX "stock_transfer_lines_tenant_id_transfer_id_idx" ON "stock_transfer_lines"("tenant_id", "transfer_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfer_lines_transfer_id_item_id_key" ON "stock_transfer_lines"("transfer_id", "item_id");

-- CreateIndex
CREATE INDEX "stock_takes_tenant_id_clinic_id_status_idx" ON "stock_takes"("tenant_id", "clinic_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_takes_tenant_id_take_number_key" ON "stock_takes"("tenant_id", "take_number");

-- CreateIndex
CREATE INDEX "stock_take_assignments_tenant_id_stock_take_id_idx" ON "stock_take_assignments"("tenant_id", "stock_take_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_take_assignments_stock_take_id_staff_id_location_key" ON "stock_take_assignments"("stock_take_id", "staff_id", "location");

-- CreateIndex
CREATE INDEX "stock_take_lines_tenant_id_stock_take_id_idx" ON "stock_take_lines"("tenant_id", "stock_take_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_take_lines_stock_take_id_item_id_key" ON "stock_take_lines"("stock_take_id", "item_id");

-- CreateIndex
CREATE INDEX "procurement_budgets_tenant_id_clinic_id_period_idx" ON "procurement_budgets"("tenant_id", "clinic_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "procurement_budgets_tenant_id_clinic_id_period_category_key" ON "procurement_budgets"("tenant_id", "clinic_id", "period", "category");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_clinic_id_fkey" FOREIGN KEY ("from_clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_clinic_id_fkey" FOREIGN KEY ("to_clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_sent_by_staff_id_fkey" FOREIGN KEY ("sent_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_received_by_staff_id_fkey" FOREIGN KEY ("received_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_cancelled_by_staff_id_fkey" FOREIGN KEY ("cancelled_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "stock_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_takes" ADD CONSTRAINT "stock_takes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_takes" ADD CONSTRAINT "stock_takes_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_takes" ADD CONSTRAINT "stock_takes_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_takes" ADD CONSTRAINT "stock_takes_submitted_by_staff_id_fkey" FOREIGN KEY ("submitted_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_takes" ADD CONSTRAINT "stock_takes_reviewed_by_staff_id_fkey" FOREIGN KEY ("reviewed_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_take_assignments" ADD CONSTRAINT "stock_take_assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_take_assignments" ADD CONSTRAINT "stock_take_assignments_stock_take_id_fkey" FOREIGN KEY ("stock_take_id") REFERENCES "stock_takes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_take_assignments" ADD CONSTRAINT "stock_take_assignments_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_take_lines" ADD CONSTRAINT "stock_take_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_take_lines" ADD CONSTRAINT "stock_take_lines_stock_take_id_fkey" FOREIGN KEY ("stock_take_id") REFERENCES "stock_takes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_take_lines" ADD CONSTRAINT "stock_take_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_take_lines" ADD CONSTRAINT "stock_take_lines_counted_by_staff_id_fkey" FOREIGN KEY ("counted_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_budgets" ADD CONSTRAINT "procurement_budgets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_budgets" ADD CONSTRAINT "procurement_budgets_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_budgets" ADD CONSTRAINT "procurement_budgets_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- ROW-LEVEL SECURITY. Same shape as every other table (see
-- force_rls_core_foundation for why ENABLE and FORCE are both required).
-- ---------------------------------------------------------------------------
ALTER TABLE "stock_transfers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_transfers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stock_transfers"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "stock_transfer_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_transfer_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stock_transfer_lines"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "stock_takes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_takes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stock_takes"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "stock_take_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_take_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stock_take_lines"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "stock_take_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_take_assignments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stock_take_assignments"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "procurement_budgets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "procurement_budgets" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "procurement_budgets"
  USING (tenant_id = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------------
-- A TRANSFER HAS TWO DIFFERENT ENDS.
--
-- Enforced in the database rather than only in the service, because a
-- self-transfer is the kind of thing a UI bug produces and it would net to
-- zero on the ledger while looking, in every report, like real movement.
-- ---------------------------------------------------------------------------
ALTER TABLE "stock_transfers" ADD CONSTRAINT stock_transfers_distinct_ends
  CHECK (from_clinic_id <> to_clinic_id);

-- Quantities are counts of things on a shelf. Negative is not a smaller
-- transfer, it is a transfer in the other direction pretending to be this one.
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT stock_transfer_lines_sent_positive
  CHECK (quantity_sent > 0);
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT stock_transfer_lines_received_not_negative
  CHECK (quantity_received IS NULL OR quantity_received >= 0);

-- A counted quantity may legitimately be zero (the shelf is empty). It may
-- not be negative.
ALTER TABLE "stock_take_lines" ADD CONSTRAINT stock_take_lines_counted_not_negative
  CHECK (counted_quantity IS NULL OR counted_quantity >= 0);
ALTER TABLE "stock_take_lines" ADD CONSTRAINT stock_take_lines_recount_not_negative
  CHECK (recount_quantity IS NULL OR recount_quantity >= 0);

ALTER TABLE "procurement_budgets" ADD CONSTRAINT procurement_budgets_amount_not_negative
  CHECK (amount >= 0);

-- ---------------------------------------------------------------------------
-- THE LEDGER IS APPEND-ONLY, ENFORCED.
--
-- `stock_movements` has always been DOCUMENTED as append-only
-- ("docs/DATABASE_ARCHITECTURE.md §6: StockLevel is the derived/cached total,
-- never the only record of truth"), and nothing stopped an UPDATE. Now that
-- stock takes post corrections THROUGH this table, a rewritable ledger would
-- mean an approved variance could be silently altered after the fact — and
-- `StockLevel` would still agree with it, because StockLevel is derived from
-- exactly these rows.
--
-- No column may change after insert. A movement recorded in error is
-- corrected by a COMPENSATING movement, which is the same discipline the
-- payments table follows and the same one an accountant would recognise.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION stock_movements_append_only() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'stock_movements is append-only: correct a movement with a compensating movement, never by deleting it';
  END IF;
  RAISE EXCEPTION 'stock_movements is append-only: correct a movement with a compensating movement, never by editing it';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stock_movements_append_only_trigger
  BEFORE UPDATE OR DELETE ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION stock_movements_append_only();

REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "stock_movements" FROM PUBLIC;
