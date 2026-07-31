-- Clinical Operations, Phase A1 (Queue End-to-End). Minimal panel/TPA
-- catalog (name + informational limit) plus the FK linking a Visit to the
-- panel it was registered under.

-- CreateTable
CREATE TABLE "panel_clinics" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "limit_amount" DECIMAL(10,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "panel_clinics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "panel_clinics_tenant_id_idx" ON "panel_clinics"("tenant_id");

-- AddForeignKey
ALTER TABLE "panel_clinics" ADD CONSTRAINT "panel_clinics_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "visits" ADD COLUMN "panel_clinic_id" TEXT;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_panel_clinic_id_fkey" FOREIGN KEY ("panel_clinic_id") REFERENCES "panel_clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-Level Security (see force_rls_core_foundation migration for why both
-- ENABLE and FORCE are required).
ALTER TABLE "panel_clinics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "panel_clinics" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "panel_clinics"
  USING (tenant_id = current_setting('app.tenant_id', true));
