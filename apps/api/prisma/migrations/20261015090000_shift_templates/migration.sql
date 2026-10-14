-- SHIFT TEMPLATES (UAT, 14 October 2026): clinic-defined shifts per group,
-- the week's first day and a branch's opening hours. Nothing is backfilled:
-- shifts already rostered keep no template, no break and no night flag.
-- CreateEnum
CREATE TYPE "ShiftGroup" AS ENUM ('DOCTOR', 'STAFF');

-- CreateEnum
CREATE TYPE "ShiftTemplateKind" AS ENUM ('WORKING', 'OFF');

-- AlterTable
ALTER TABLE "provider_shifts" ADD COLUMN     "break_minutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "night" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "template_id" TEXT;

-- AlterTable
ALTER TABLE "attendance_policies" ADD COLUMN     "close_time" TEXT,
ADD COLUMN     "open_24_hours" BOOLEAN,
ADD COLUMN     "open_time" TEXT,
ADD COLUMN     "week_start_day" INTEGER;

-- CreateTable
CREATE TABLE "shift_templates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "clinic_id" TEXT,
    "group" "ShiftGroup" NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ShiftTemplateKind" NOT NULL DEFAULT 'WORKING',
    "start_time" TEXT,
    "end_time" TEXT,
    "break_minutes" INTEGER NOT NULL DEFAULT 0,
    "night" BOOLEAN NOT NULL DEFAULT false,
    "colour" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_staff_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shift_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shift_templates_tenant_id_group_idx" ON "shift_templates"("tenant_id", "group");

-- AddForeignKey
ALTER TABLE "provider_shifts" ADD CONSTRAINT "provider_shifts_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "shift_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_templates" ADD CONSTRAINT "shift_templates_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;


ALTER TABLE "shift_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shift_templates" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "shift_templates"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kuwick_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "shift_templates" TO kuwick_app;
  END IF;
END $$;
