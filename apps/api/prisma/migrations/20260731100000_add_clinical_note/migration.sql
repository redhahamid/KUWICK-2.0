-- Clinical Operations, Phase 2a: the audited kuwick.com Clinical Notes tab
-- (Vital Signs, Anthropometry, Point-of-Care, Notes with a language
-- toggle). One row per Visit, created lazily on first save — every clinical
-- field is nullable since it's filled in progressively during a
-- consultation. BMI is derived from weight/height at read time, not stored.

-- CreateEnum
CREATE TYPE "NoteLanguage" AS ENUM ('EN', 'MS');

-- CreateTable
CREATE TABLE "clinical_notes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "visit_id" TEXT NOT NULL,
    "bp_systolic" INTEGER,
    "bp_diastolic" INTEGER,
    "pulse" INTEGER,
    "temperature" DECIMAL(4,1),
    "spo2" INTEGER,
    "resp_rate" INTEGER,
    "pain_score" INTEGER,
    "weight" DECIMAL(5,2),
    "height" DECIMAL(5,2),
    "head_circumference" DECIMAL(5,2),
    "glucose" DECIMAL(5,2),
    "notes" TEXT,
    "note_language" "NoteLanguage" NOT NULL DEFAULT 'EN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinical_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clinical_notes_visit_id_key" ON "clinical_notes"("visit_id");

-- CreateIndex
CREATE INDEX "clinical_notes_tenant_id_idx" ON "clinical_notes"("tenant_id");

-- AddForeignKey
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-Level Security (see force_rls_core_foundation migration for why both
-- ENABLE and FORCE are required).
ALTER TABLE "clinical_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clinical_notes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "clinical_notes"
  USING (tenant_id = current_setting('app.tenant_id', true));
