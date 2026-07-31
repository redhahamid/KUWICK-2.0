-- Clinical Operations, Phase 3 (Medications). Extends Item with the
-- fields the audited kuwick.com Edit Inventory screen shows for
-- medicines (Conc. Vol/Strength for the dosage calculator, Consumption
-- Method, Default Dispense Quantity, a free-text Prescription Reference,
-- Remark), adds a per-medicine age-dosage bracket table, and adds the
-- Prescription model itself. DISPENSED is a new StockMovementType value —
-- D-028 (docs/DECISIONS.md): stock only moves when a prescription is
-- marked DISPENSED, not when it's written.

-- AlterEnum
ALTER TYPE "StockMovementType" ADD VALUE 'DISPENSED';

-- CreateEnum
CREATE TYPE "PrescriptionStatus" AS ENUM ('ORDERED', 'DISPENSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DosageCalcMethod" AS ENUM ('WEIGHT_BASED', 'AGE_BASED', 'MANUAL');

-- AlterTable
ALTER TABLE "items" ADD COLUMN "code" TEXT;
ALTER TABLE "items" ADD COLUMN "dose_unit_default" TEXT;
ALTER TABLE "items" ADD COLUMN "conc_vol_ml" DECIMAL(10,2);
ALTER TABLE "items" ADD COLUMN "strength_mg" DECIMAL(10,2);
ALTER TABLE "items" ADD COLUMN "consumption_method" TEXT;
ALTER TABLE "items" ADD COLUMN "default_dispense_quantity" INTEGER;
ALTER TABLE "items" ADD COLUMN "prescriptionReference" TEXT;
ALTER TABLE "items" ADD COLUMN "remark" TEXT;

-- CreateTable
CREATE TABLE "item_age_dosages" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "age_from_months" INTEGER NOT NULL,
    "age_to_months" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "unit" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_age_dosages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescriptions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "visit_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "amount" DECIMAL(10,2) NOT NULL,
    "unit" TEXT,
    "frequency" TEXT NOT NULL,
    "duration_days" INTEGER NOT NULL,
    "indication" TEXT,
    "remark" TEXT,
    "calc_method" "DosageCalcMethod",
    "calc_weight_kg" DECIMAL(6,2),
    "calc_dose_rate_mg_kg" DECIMAL(6,2),
    "calc_target_dose_mg" DECIMAL(10,2),
    "status" "PrescriptionStatus" NOT NULL DEFAULT 'ORDERED',
    "prescribed_by_staff_id" TEXT NOT NULL,
    "prescribed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispensed_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prescriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "item_age_dosages_tenant_id_item_id_idx" ON "item_age_dosages"("tenant_id", "item_id");

-- CreateIndex
CREATE INDEX "prescriptions_tenant_id_visit_id_idx" ON "prescriptions"("tenant_id", "visit_id");

-- AddForeignKey
ALTER TABLE "item_age_dosages" ADD CONSTRAINT "item_age_dosages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "item_age_dosages" ADD CONSTRAINT "item_age_dosages_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_prescribed_by_staff_id_fkey" FOREIGN KEY ("prescribed_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-Level Security (see force_rls_core_foundation migration for why both
-- ENABLE and FORCE are required).
ALTER TABLE "item_age_dosages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "item_age_dosages" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "item_age_dosages"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "prescriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "prescriptions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "prescriptions"
  USING (tenant_id = current_setting('app.tenant_id', true));
