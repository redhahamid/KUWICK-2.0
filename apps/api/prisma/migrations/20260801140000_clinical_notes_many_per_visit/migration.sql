-- D-044: ClinicalNote goes from one-per-visit to many-per-visit — a single
-- consultation can carry several notes (e.g. triage vitals, then a
-- reassessment note after a nebuliser). Drops the unique constraint on
-- visit_id and adds a plain composite index for the tenant-scoped list
-- query, ordered by created_at.

-- DropIndex
DROP INDEX "clinical_notes_visit_id_key";

-- CreateIndex
CREATE INDEX "clinical_notes_tenant_id_visit_id_idx" ON "clinical_notes"("tenant_id", "visit_id");
