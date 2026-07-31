-- Clinical Operations, Phase A8. Per-panel price overrides + coverage
-- exclusions (settled together per owner request), and invoice-line
-- source-linking so completed services/dispensed medications can be
-- Quick-Added to an invoice and deduped.

-- CreateTable
CREATE TABLE "panel_price_overrides" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "panel_clinic_id" TEXT NOT NULL,
    "item_id" TEXT,
    "service_catalog_id" TEXT,
    "override_price" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "panel_price_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "panel_exclusions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "panel_clinic_id" TEXT NOT NULL,
    "item_id" TEXT,
    "service_catalog_id" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "panel_exclusions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "panel_price_overrides_tenant_id_panel_clinic_id_idx" ON "panel_price_overrides"("tenant_id", "panel_clinic_id");
CREATE INDEX "panel_price_overrides_tenant_id_item_id_idx" ON "panel_price_overrides"("tenant_id", "item_id");
CREATE INDEX "panel_price_overrides_tenant_id_service_catalog_id_idx" ON "panel_price_overrides"("tenant_id", "service_catalog_id");
CREATE INDEX "panel_exclusions_tenant_id_panel_clinic_id_idx" ON "panel_exclusions"("tenant_id", "panel_clinic_id");
CREATE INDEX "panel_exclusions_tenant_id_item_id_idx" ON "panel_exclusions"("tenant_id", "item_id");
CREATE INDEX "panel_exclusions_tenant_id_service_catalog_id_idx" ON "panel_exclusions"("tenant_id", "service_catalog_id");

-- AddForeignKey
ALTER TABLE "panel_price_overrides" ADD CONSTRAINT "panel_price_overrides_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "panel_price_overrides" ADD CONSTRAINT "panel_price_overrides_panel_clinic_id_fkey" FOREIGN KEY ("panel_clinic_id") REFERENCES "panel_clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "panel_price_overrides" ADD CONSTRAINT "panel_price_overrides_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "panel_price_overrides" ADD CONSTRAINT "panel_price_overrides_service_catalog_id_fkey" FOREIGN KEY ("service_catalog_id") REFERENCES "service_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "panel_exclusions" ADD CONSTRAINT "panel_exclusions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "panel_exclusions" ADD CONSTRAINT "panel_exclusions_panel_clinic_id_fkey" FOREIGN KEY ("panel_clinic_id") REFERENCES "panel_clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "panel_exclusions" ADD CONSTRAINT "panel_exclusions_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "panel_exclusions" ADD CONSTRAINT "panel_exclusions_service_catalog_id_fkey" FOREIGN KEY ("service_catalog_id") REFERENCES "service_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-Level Security (see force_rls_core_foundation migration for why both
-- ENABLE and FORCE are required).
ALTER TABLE "panel_price_overrides" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "panel_price_overrides" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "panel_price_overrides"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "panel_exclusions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "panel_exclusions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "panel_exclusions"
  USING (tenant_id = current_setting('app.tenant_id', true));

-- AlterTable
ALTER TABLE "invoice_lines" ADD COLUMN "source_order_service_id" TEXT;
ALTER TABLE "invoice_lines" ADD COLUMN "source_prescription_id" TEXT;
ALTER TABLE "invoice_lines" ADD COLUMN "excluded_from_panel" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_source_order_service_id_fkey" FOREIGN KEY ("source_order_service_id") REFERENCES "order_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_source_prescription_id_fkey" FOREIGN KEY ("source_prescription_id") REFERENCES "prescriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
