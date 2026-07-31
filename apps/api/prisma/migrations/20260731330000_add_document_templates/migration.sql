-- Document builder (D-040): per-clinic custom document templates, the
-- platform's global defaults they're copied from, a CUSTOM document type,
-- and a title for custom documents.

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'CUSTOM';

-- AlterTable
ALTER TABLE "documents" ADD COLUMN "title" TEXT;

-- CreateTable
CREATE TABLE "custom_document_templates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "source_default_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "custom_document_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "default_document_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "default_document_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "custom_document_templates_tenant_id_name_key" ON "custom_document_templates"("tenant_id", "name");
CREATE INDEX "custom_document_templates_tenant_id_idx" ON "custom_document_templates"("tenant_id");

-- AddForeignKey
ALTER TABLE "custom_document_templates" ADD CONSTRAINT "custom_document_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Standard tenant-isolation RLS on the tenant-scoped table; none on the
-- platform defaults (same as the other default catalogs, D-037).
ALTER TABLE "custom_document_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "custom_document_templates" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "custom_document_templates"
  USING (tenant_id = current_setting('app.tenant_id', true));
