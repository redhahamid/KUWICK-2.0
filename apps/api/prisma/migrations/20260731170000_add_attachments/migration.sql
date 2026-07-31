-- Clinical Operations, Phase A3 (Task/procedure result file uploads). Files
-- are stored on local disk; this table only tracks metadata + the relative
-- path on disk.

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "order_service_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "uploaded_by_staff_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attachments_tenant_id_order_service_id_idx" ON "attachments"("tenant_id", "order_service_id");

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_order_service_id_fkey" FOREIGN KEY ("order_service_id") REFERENCES "order_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_staff_id_fkey" FOREIGN KEY ("uploaded_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-Level Security (see force_rls_core_foundation migration for why both
-- ENABLE and FORCE are required).
ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attachments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "attachments"
  USING (tenant_id = current_setting('app.tenant_id', true));
