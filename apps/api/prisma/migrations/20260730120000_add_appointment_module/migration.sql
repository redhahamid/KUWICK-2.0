-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('REQUESTED', 'CONFIRMED', 'REMINDED', 'ARRIVED', 'IN_QUEUE', 'COMPLETED', 'RESCHEDULED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "AppointmentSource" AS ENUM ('ONLINE_PORTAL', 'FRONT_DESK');

-- CreateTable
-- TEMPORARY: stands in for Clinical Operations' future ServiceCatalog (see
-- the model comment in schema.prisma and docs/DECISIONS.md).
CREATE TABLE "appointment_services" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "duration_minutes_default" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointment_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_schedules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "start_time" TIME NOT NULL,
    "end_time" TIME NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doctor_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_exceptions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "start_time" TIME,
    "end_time" TIME,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedule_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slot_capacity_configs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "slot_length_minutes" INTEGER NOT NULL,
    "daily_capacity" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slot_capacity_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_service_qualifications" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "doctor_service_qualifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'REQUESTED',
    "source" "AppointmentSource" NOT NULL,
    "scheduled_start" TIMESTAMP(3) NOT NULL,
    "scheduled_end" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "cancel_reason" TEXT,
    "arrived_at" TIMESTAMP(3),
    "rescheduled_from_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appointment_services_tenant_id_idx" ON "appointment_services"("tenant_id");

-- CreateIndex
CREATE INDEX "doctor_schedules_tenant_id_idx" ON "doctor_schedules"("tenant_id");
CREATE INDEX "doctor_schedules_tenant_id_clinic_id_idx" ON "doctor_schedules"("tenant_id", "clinic_id");
CREATE INDEX "doctor_schedules_tenant_id_staff_id_day_of_week_idx" ON "doctor_schedules"("tenant_id", "staff_id", "day_of_week");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_exceptions_tenant_id_staff_id_clinic_id_date_key" ON "schedule_exceptions"("tenant_id", "staff_id", "clinic_id", "date");
CREATE INDEX "schedule_exceptions_tenant_id_clinic_id_idx" ON "schedule_exceptions"("tenant_id", "clinic_id");

-- CreateIndex
CREATE UNIQUE INDEX "slot_capacity_configs_tenant_id_clinic_id_staff_id_service_key" ON "slot_capacity_configs"("tenant_id", "clinic_id", "staff_id", "service_id");
CREATE INDEX "slot_capacity_configs_tenant_id_clinic_id_idx" ON "slot_capacity_configs"("tenant_id", "clinic_id");
CREATE INDEX "slot_capacity_configs_tenant_id_staff_id_idx" ON "slot_capacity_configs"("tenant_id", "staff_id");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_service_qualifications_tenant_id_staff_id_service_key" ON "doctor_service_qualifications"("tenant_id", "staff_id", "service_id");
CREATE INDEX "doctor_service_qualifications_tenant_id_staff_id_idx" ON "doctor_service_qualifications"("tenant_id", "staff_id");
CREATE INDEX "doctor_service_qualifications_tenant_id_service_id_idx" ON "doctor_service_qualifications"("tenant_id", "service_id");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_rescheduled_from_id_key" ON "appointments"("rescheduled_from_id");
CREATE INDEX "appointments_tenant_id_idx" ON "appointments"("tenant_id");
CREATE INDEX "appointments_tenant_id_clinic_id_idx" ON "appointments"("tenant_id", "clinic_id");
CREATE INDEX "appointments_tenant_id_staff_id_scheduled_start_idx" ON "appointments"("tenant_id", "staff_id", "scheduled_start");
CREATE INDEX "appointments_tenant_id_patient_id_idx" ON "appointments"("tenant_id", "patient_id");
CREATE INDEX "appointments_tenant_id_status_idx" ON "appointments"("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "appointment_services" ADD CONSTRAINT "appointment_services_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "doctor_schedules" ADD CONSTRAINT "doctor_schedules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "doctor_schedules" ADD CONSTRAINT "doctor_schedules_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "doctor_schedules" ADD CONSTRAINT "doctor_schedules_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "slot_capacity_configs" ADD CONSTRAINT "slot_capacity_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "slot_capacity_configs" ADD CONSTRAINT "slot_capacity_configs_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "slot_capacity_configs" ADD CONSTRAINT "slot_capacity_configs_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "slot_capacity_configs" ADD CONSTRAINT "slot_capacity_configs_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "appointment_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "doctor_service_qualifications" ADD CONSTRAINT "doctor_service_qualifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "doctor_service_qualifications" ADD CONSTRAINT "doctor_service_qualifications_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "doctor_service_qualifications" ADD CONSTRAINT "doctor_service_qualifications_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "appointment_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "appointment_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_rescheduled_from_id_fkey" FOREIGN KEY ("rescheduled_from_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-Level Security on every new tenant-scoped table (see the
-- force_rls_core_foundation migration for why both ENABLE and FORCE
-- are required).
ALTER TABLE "appointment_services" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "appointment_services" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "appointment_services"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "doctor_schedules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "doctor_schedules" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "doctor_schedules"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "schedule_exceptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "schedule_exceptions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "schedule_exceptions"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "slot_capacity_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "slot_capacity_configs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "slot_capacity_configs"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "doctor_service_qualifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "doctor_service_qualifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "doctor_service_qualifications"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "appointments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "appointments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "appointments"
  USING (tenant_id = current_setting('app.tenant_id', true));

-- Database-level backstop against double-booking a doctor, beyond the
-- app-level check in AppointmentBookingValidator (docs/DECISIONS.md,
-- mirrors the precedent set by StockLevel's CHECK and ClaimBatch's
-- trigger in docs/DATABASE_ARCHITECTURE.md §1: real constraints enforce
-- business rules, not application code alone). btree_gist is a trusted
-- extension since PG13 and installable without superuser.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_no_overlap"
  EXCLUDE USING gist (
    staff_id WITH =,
    tsrange(scheduled_start, scheduled_end) WITH &&
  ) WHERE (status NOT IN ('CANCELLED', 'RESCHEDULED', 'NO_SHOW'));
