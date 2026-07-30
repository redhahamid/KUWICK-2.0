-- Clinical Operations, Phase 2b: the audited kuwick.com Diagnosis tab
-- (search/add from a catalog). DiagnosisCatalog is a minimal per-tenant
-- lookup with no dedicated admin screen this phase — entries are created
-- inline from the visit's diagnosis picker. Diagnosis snapshots code/name
-- at add-time so a later catalog rename never rewrites a historical visit
-- record, same convention as PanelInvoice's price snapshot.

-- CreateTable
CREATE TABLE "diagnosis_catalog" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "diagnosis_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diagnoses" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "visit_id" TEXT NOT NULL,
    "diagnosis_catalog_id" TEXT,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "diagnoses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "diagnosis_catalog_tenant_id_name_key" ON "diagnosis_catalog"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "diagnosis_catalog_tenant_id_idx" ON "diagnosis_catalog"("tenant_id");

-- CreateIndex
CREATE INDEX "diagnoses_tenant_id_visit_id_idx" ON "diagnoses"("tenant_id", "visit_id");

-- AddForeignKey
ALTER TABLE "diagnosis_catalog" ADD CONSTRAINT "diagnosis_catalog_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_diagnosis_catalog_id_fkey" FOREIGN KEY ("diagnosis_catalog_id") REFERENCES "diagnosis_catalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-Level Security (see force_rls_core_foundation migration for why both
-- ENABLE and FORCE are required).
ALTER TABLE "diagnosis_catalog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "diagnosis_catalog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "diagnosis_catalog"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "diagnoses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "diagnoses" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "diagnoses"
  USING (tenant_id = current_setting('app.tenant_id', true));
