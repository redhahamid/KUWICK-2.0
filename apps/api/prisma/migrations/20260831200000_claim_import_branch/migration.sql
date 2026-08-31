-- WHICH BRANCH AN IMPORTED CLAIM CAME FROM.
--
-- An imported claim has no visit, and every branch-scoped finance screen reads
-- the branch from the visit. Without this, the 7,146 claims the clinic imports
-- on cutover day are invisible on Finance → Panel money — which is exactly what
-- the visual UAT pack showed. The person importing knows which branch the file
-- covers; NULL means they did not say, and the screens report those claims as
-- not attributable rather than assigning them to a branch.
ALTER TABLE "claim_import_batches" ADD COLUMN "clinic_id" TEXT;

ALTER TABLE "claim_import_batches"
    ADD CONSTRAINT "claim_import_batches_clinic_fkey"
        FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "claim_import_batches_tenant_id_clinic_id_idx"
    ON "claim_import_batches"("tenant_id", "clinic_id");
