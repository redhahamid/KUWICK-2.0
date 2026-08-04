-- CreateEnum
CREATE TYPE "VisitClassification" AS ENUM ('CONSULTATION', 'OTC_ONLY', 'DRESSING_ONLY', 'PROCEDURE_ONLY', 'FOLLOW_UP_NO_CONSULTATION');

-- AlterTable
ALTER TABLE "invoice_lines" ADD COLUMN     "consultation_tariff_rule_id" TEXT,
ADD COLUMN     "source_consultation_visit_id" TEXT;

-- AlterTable
ALTER TABLE "visits" ADD COLUMN     "classification" "VisitClassification";

-- CreateTable
CREATE TABLE "consultation_tariff_rules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "classification" "VisitClassification" NOT NULL DEFAULT 'CONSULTATION',
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "service_catalog_id" TEXT NOT NULL,
    "effective_from" TIMESTAMP(3),
    "effective_to" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consultation_tariff_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "consultation_tariff_rules_tenant_id_clinic_id_active_idx" ON "consultation_tariff_rules"("tenant_id", "clinic_id", "active");

-- AddForeignKey
ALTER TABLE "consultation_tariff_rules" ADD CONSTRAINT "consultation_tariff_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_tariff_rules" ADD CONSTRAINT "consultation_tariff_rules_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_tariff_rules" ADD CONSTRAINT "consultation_tariff_rules_service_catalog_id_fkey" FOREIGN KEY ("service_catalog_id") REFERENCES "service_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_source_consultation_visit_id_fkey" FOREIGN KEY ("source_consultation_visit_id") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_consultation_tariff_rule_id_fkey" FOREIGN KEY ("consultation_tariff_rule_id") REFERENCES "consultation_tariff_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- RLS — same tenant_isolation shape as every other tenant-scoped table.
-- ---------------------------------------------------------------------------
ALTER TABLE "consultation_tariff_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consultation_tariff_rules" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "consultation_tariff_rules";
CREATE POLICY tenant_isolation ON "consultation_tariff_rules"
  USING (tenant_id = current_setting('app.tenant_id', true));
