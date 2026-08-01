-- D-045: a staff member's home branch. Null means they work across every
-- clinic in the tenant (owner/finance/HR-type roles) and still see a
-- clinic picker where relevant; set means every clinic-scoped screen
-- auto-resolves to this clinic and the picker never shows — "log in and
-- you're already at your clinic," not a re-selection on every screen.
-- No backfill needed: single-clinic tenants (the common case) already
-- auto-resolve correctly with clinic_id left null, since the frontend
-- falls back to "the tenant's only clinic" when there's just one.

-- AlterTable
ALTER TABLE "staff" ADD COLUMN "clinic_id" TEXT;

-- CreateIndex
CREATE INDEX "staff_tenant_id_clinic_id_idx" ON "staff"("tenant_id", "clinic_id");

-- AddForeignKey
ALTER TABLE "staff" ADD CONSTRAINT "staff_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;
