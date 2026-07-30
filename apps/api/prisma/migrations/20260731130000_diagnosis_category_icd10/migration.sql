-- D-027 (docs/DECISIONS.md): corrects the Clinical 2b Diagnosis catalog to
-- match kuwick.com's real Custom/Summarize/Full semantics — these are
-- catalog source categories (clinic-created / curated global subset /
-- full ICD-10 standard), not display-density modes. Renames `code` to
-- `icd10_code` for clarity (procedure "code" elsewhere means something
-- different) and adds `category`.

-- CreateEnum
CREATE TYPE "DiagnosisCategory" AS ENUM ('CUSTOM', 'SUMMARIZE', 'FULL');

-- AlterTable
ALTER TABLE "diagnosis_catalog" RENAME COLUMN "code" TO "icd10_code";
ALTER TABLE "diagnosis_catalog" ADD COLUMN "category" "DiagnosisCategory" NOT NULL DEFAULT 'CUSTOM';

-- CreateIndex
CREATE INDEX "diagnosis_catalog_tenant_id_category_idx" ON "diagnosis_catalog"("tenant_id", "category");

-- AlterTable
ALTER TABLE "diagnoses" RENAME COLUMN "code" TO "icd10_code";
