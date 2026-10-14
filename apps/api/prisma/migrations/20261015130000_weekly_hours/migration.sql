-- Section C (14 October 2026): overtime and locum worked out week by week.
-- Existing rule sets keep overtime_basis NULL (day by day, as before) until the
-- clinic chooses a basis in Settings, so no month already paid is paid again.

-- CreateEnum
CREATE TYPE "OvertimeBasis" AS ENUM ('ACT', 'WEEKLY', 'AVERAGED');

-- CreateEnum
CREATE TYPE "NightPayMode" AS ENUM ('PER_SHIFT', 'PER_HOUR');

-- AlterTable
ALTER TABLE "public_holidays" ADD COLUMN     "multiplier" DECIMAL(4,2);

-- AlterTable
ALTER TABLE "shift_templates" ADD COLUMN     "night_pay_mode" "NightPayMode",
ADD COLUMN     "night_rate" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "employee_profiles" ADD COLUMN     "locum_rate" DECIMAL(10,2),
ADD COLUMN     "night_pay_mode" "NightPayMode",
ADD COLUMN     "night_rate" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "payroll_policies" ADD COLUMN     "locum_hourly_rate" DECIMAL(10,2),
ADD COLUMN     "overtime_basis" "OvertimeBasis",
ADD COLUMN     "overtime_wage_ceiling" DECIMAL(12,2),
ADD COLUMN     "weekly_normal_hours" DECIMAL(5,2) NOT NULL DEFAULT 45;

-- CreateTable
CREATE TABLE "work_weeks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "week_start" DATE NOT NULL,
    "week_end" DATE NOT NULL,
    "earned_month" DATE NOT NULL,
    "overtime_minutes" INTEGER NOT NULL DEFAULT 0,
    "locum_minutes" INTEGER NOT NULL DEFAULT 0,
    "night_shifts" INTEGER NOT NULL DEFAULT 0,
    "amount_cents" INTEGER NOT NULL DEFAULT 0,
    "working" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_weeks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_weeks_tenant_id_earned_month_idx" ON "work_weeks"("tenant_id", "earned_month");

-- CreateIndex
CREATE UNIQUE INDEX "work_weeks_staff_id_week_start_key" ON "work_weeks"("staff_id", "week_start");

-- AddForeignKey
ALTER TABLE "work_weeks" ADD CONSTRAINT "work_weeks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_weeks" ADD CONSTRAINT "work_weeks_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "work_weeks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "work_weeks" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "work_weeks"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kuwick_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "work_weeks" TO kuwick_app;
  END IF;
END $$;
