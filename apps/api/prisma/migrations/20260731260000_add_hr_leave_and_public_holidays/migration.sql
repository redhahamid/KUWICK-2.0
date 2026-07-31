-- HR, Phase 1c (unblocked scope only — leave request/approval and public
-- holidays). Attendance is a read-only derived report over
-- Visit.checkInAt/checkOutAt, so it needs no table here. The Doctor
-- Incentive Engine stays unbuilt, parked on Open Question #2.

-- CreateEnum
CREATE TYPE "LeaveType" AS ENUM ('ANNUAL', 'MEDICAL', 'EMERGENCY', 'UNPAID', 'OTHER');
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "leave_type" "LeaveType" NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "reason" TEXT,
    "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING',
    "approved_by_staff_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "reject_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_holidays" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leave_requests_tenant_id_staff_id_idx" ON "leave_requests"("tenant_id", "staff_id");
CREATE INDEX "leave_requests_tenant_id_status_idx" ON "leave_requests"("tenant_id", "status");
CREATE UNIQUE INDEX "public_holidays_tenant_id_date_key" ON "public_holidays"("tenant_id", "date");
CREATE INDEX "public_holidays_tenant_id_idx" ON "public_holidays"("tenant_id");

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_approved_by_staff_id_fkey" FOREIGN KEY ("approved_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public_holidays" ADD CONSTRAINT "public_holidays_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-Level Security (see force_rls_core_foundation migration for why both
-- ENABLE and FORCE are required).
ALTER TABLE "leave_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "leave_requests"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "public_holidays" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public_holidays" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "public_holidays"
  USING (tenant_id = current_setting('app.tenant_id', true));
