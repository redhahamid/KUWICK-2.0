-- D-044: free-standing visit-level uploads (photos, scanned results, PDFs)
-- shown alongside Clinical Notes/Vitals — distinct from "attachments"
-- (order/procedure result uploads only). Same local-disk storage
-- convention (core/file-storage.ts) and RLS pattern as every other table.

-- CreateTable
CREATE TABLE "visit_attachments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "visit_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "uploaded_by_staff_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "visit_attachments_tenant_id_visit_id_idx" ON "visit_attachments"("tenant_id", "visit_id");

-- AddForeignKey
ALTER TABLE "visit_attachments" ADD CONSTRAINT "visit_attachments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "visit_attachments" ADD CONSTRAINT "visit_attachments_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "visit_attachments" ADD CONSTRAINT "visit_attachments_uploaded_by_staff_id_fkey" FOREIGN KEY ("uploaded_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-Level Security (see force_rls_core_foundation migration for why both
-- ENABLE and FORCE are required).
ALTER TABLE "visit_attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visit_attachments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "visit_attachments"
  USING (tenant_id = current_setting('app.tenant_id', true));
