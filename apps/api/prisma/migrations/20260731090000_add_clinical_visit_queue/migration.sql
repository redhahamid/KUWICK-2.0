-- CreateEnum
CREATE TYPE "QueueTicketStatus" AS ENUM ('WAITING', 'IN_CONSULTATION', 'DISPENSARY_PAYMENT', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "visits" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "visit_number" TEXT NOT NULL,
    "billing_type" TEXT NOT NULL,
    "presenting_complaint" TEXT,
    "check_in_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "check_out_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_tickets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "visit_id" TEXT NOT NULL,
    "ticket_number" INTEGER NOT NULL,
    "status" "QueueTicketStatus" NOT NULL DEFAULT 'WAITING',
    "location" TEXT,
    "called_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "queue_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "visits_tenant_id_visit_number_key" ON "visits"("tenant_id", "visit_number");

-- CreateIndex
CREATE INDEX "visits_tenant_id_clinic_id_idx" ON "visits"("tenant_id", "clinic_id");

-- CreateIndex
CREATE INDEX "visits_tenant_id_patient_id_idx" ON "visits"("tenant_id", "patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "queue_tickets_visit_id_key" ON "queue_tickets"("visit_id");

-- CreateIndex
CREATE INDEX "queue_tickets_tenant_id_clinic_id_status_idx" ON "queue_tickets"("tenant_id", "clinic_id", "status");

-- CreateIndex
CREATE INDEX "queue_tickets_tenant_id_clinic_id_created_at_idx" ON "queue_tickets"("tenant_id", "clinic_id", "created_at");

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "visits" ADD CONSTRAINT "visits_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "visits" ADD CONSTRAINT "visits_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "visits" ADD CONSTRAINT "visits_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_tickets" ADD CONSTRAINT "queue_tickets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "queue_tickets" ADD CONSTRAINT "queue_tickets_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "queue_tickets" ADD CONSTRAINT "queue_tickets_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-Level Security on every new tenant-scoped table (see
-- force_rls_core_foundation migration for why both ENABLE and FORCE
-- are required).
ALTER TABLE "visits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visits" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "visits"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "queue_tickets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "queue_tickets" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "queue_tickets"
  USING (tenant_id = current_setting('app.tenant_id', true));
