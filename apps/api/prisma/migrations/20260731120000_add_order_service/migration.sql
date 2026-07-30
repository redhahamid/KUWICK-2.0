-- Clinical Operations, Phase 2c: the audited kuwick.com Orders & Services
-- tab and the standalone Procedure Task Queue. ServiceCatalog gains `code`
-- and `order_type` so Task Orders (procedures, e.g. XRAYCHEST) and Standard
-- Services share one catalog/picker, matching the single "Add Order or
-- Service" selector — order_type defaults to STANDARD_SERVICE so existing
-- rows (all booking-time consultation services) are unaffected.
-- OrderService is the per-visit instance, snapshotting code/procedureName/
-- orderType from the catalog at order time (docs/DECISIONS.md).

-- CreateEnum
CREATE TYPE "ServiceOrderType" AS ENUM ('STANDARD_SERVICE', 'TASK_ORDER');

-- CreateEnum
CREATE TYPE "OrderServiceStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "service_catalog" ADD COLUMN "code" TEXT;
ALTER TABLE "service_catalog" ADD COLUMN "order_type" "ServiceOrderType" NOT NULL DEFAULT 'STANDARD_SERVICE';

-- CreateTable
CREATE TABLE "order_services" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "visit_id" TEXT NOT NULL,
    "service_catalog_id" TEXT NOT NULL,
    "code" TEXT,
    "procedure_name" TEXT NOT NULL,
    "order_type" "ServiceOrderType" NOT NULL,
    "instruction" TEXT,
    "result" TEXT,
    "status" "OrderServiceStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_staff_id" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_services_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_services_tenant_id_visit_id_idx" ON "order_services"("tenant_id", "visit_id");

-- CreateIndex
CREATE INDEX "order_services_tenant_id_clinic_id_order_type_status_idx" ON "order_services"("tenant_id", "clinic_id", "order_type", "status");

-- AddForeignKey
ALTER TABLE "order_services" ADD CONSTRAINT "order_services_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_services" ADD CONSTRAINT "order_services_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_services" ADD CONSTRAINT "order_services_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_services" ADD CONSTRAINT "order_services_service_catalog_id_fkey" FOREIGN KEY ("service_catalog_id") REFERENCES "service_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_services" ADD CONSTRAINT "order_services_requested_by_staff_id_fkey" FOREIGN KEY ("requested_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-Level Security (see force_rls_core_foundation migration for why both
-- ENABLE and FORCE are required).
ALTER TABLE "order_services" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_services" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "order_services"
  USING (tenant_id = current_setting('app.tenant_id', true));
