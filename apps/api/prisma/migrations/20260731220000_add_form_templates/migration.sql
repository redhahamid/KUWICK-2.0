-- Clinical Operations, Phase A7. Admin-defined result form templates
-- ("Google Forms but for lab/procedure results"), linked optionally to a
-- ServiceCatalog entry, applied at OrderService completion time.

-- CreateTable
CREATE TABLE "form_templates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "service_catalog_id" TEXT,
    "fields" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "form_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "form_templates_tenant_id_idx" ON "form_templates"("tenant_id");
CREATE INDEX "form_templates_tenant_id_service_catalog_id_idx" ON "form_templates"("tenant_id", "service_catalog_id");

-- AddForeignKey
ALTER TABLE "form_templates" ADD CONSTRAINT "form_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "form_templates" ADD CONSTRAINT "form_templates_service_catalog_id_fkey" FOREIGN KEY ("service_catalog_id") REFERENCES "service_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-Level Security (see force_rls_core_foundation migration for why both
-- ENABLE and FORCE are required).
ALTER TABLE "form_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "form_templates" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "form_templates"
  USING (tenant_id = current_setting('app.tenant_id', true));

-- AlterTable
ALTER TABLE "order_services" ADD COLUMN "form_template_id" TEXT;
ALTER TABLE "order_services" ADD COLUMN "form_data" JSONB;

-- AddForeignKey
ALTER TABLE "order_services" ADD CONSTRAINT "order_services_form_template_id_fkey" FOREIGN KEY ("form_template_id") REFERENCES "form_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
