-- ===========================================================================
-- ADMIN PROGRAMME — WAVE 4: HR, WORKFORCE AND PAYROLL
--
-- Additive only. `staff` gains nothing; `employee_profiles` EXTENDS it 1:1, so
-- a person is still one row and the three identities the brief keeps apart
-- (user account, employee, clinical provider) each stay in their own place.
--
-- NOTHING IS SEEDED, and one omission is deliberate: `statutory_rule_sets` is
-- created EMPTY. Malaysian EPF, SOCSO, EIS and PCB rates are not hardcoded
-- anywhere in this system. A payroll run over a period with no configured rule
-- set is marked NOT_CONFIGURED, its statutory columns stay NULL rather than
-- zero, and the payslip says so — because a wrong EPF figure that looks right
-- is worse than no EPF figure at all.
-- ===========================================================================


-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('PERMANENT', 'CONTRACT', 'LOCUM', 'PART_TIME', 'INTERN');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('ACTIVE', 'PROBATION', 'NOTICE', 'SUSPENDED', 'RESIGNED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'ABSENT', 'ON_LEAVE', 'HOLIDAY', 'REST_DAY', 'MISSING_PUNCH');

-- CreateEnum
CREATE TYPE "IncentiveRuleType" AS ENUM ('SALES_COMMISSION', 'PROCEDURE');

-- CreateEnum
CREATE TYPE "IncentiveRunStatus" AS ENUM ('DRAFT', 'CALCULATED', 'APPROVED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StatutoryStatus" AS ENUM ('CONFIGURED', 'NOT_CONFIGURED', 'PROVISIONAL');

-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'CALCULATED', 'APPROVED', 'PAID', 'CANCELLED');

-- CreateTable
CREATE TABLE "employee_profiles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "employee_no" TEXT,
    "legal_name" TEXT,
    "identifier_type" TEXT,
    "identifier_value" TEXT,
    "date_of_birth" DATE,
    "gender" TEXT,
    "nationality" TEXT,
    "marital_status" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "emergency_contact_name" TEXT,
    "emergency_contact_phone" TEXT,
    "emergency_contact_relation" TEXT,
    "employment_type" "EmploymentType" NOT NULL DEFAULT 'PERMANENT',
    "employment_status" "EmploymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "department" TEXT,
    "position" TEXT,
    "manager_staff_id" TEXT,
    "start_date" DATE,
    "confirmed_date" DATE,
    "end_date" DATE,
    "end_reason" TEXT,
    "basic_salary" DECIMAL(12,2),
    "hourly_rate" DECIMAL(10,2),
    "bank_name" TEXT,
    "bank_account_no" TEXT,
    "bank_account_name" TEXT,
    "epf_number" TEXT,
    "socso_number" TEXT,
    "tax_number" TEXT,
    "tax_category" TEXT,
    "epf_applicable" BOOLEAN NOT NULL DEFAULT true,
    "socso_applicable" BOOLEAN NOT NULL DEFAULT true,
    "eis_applicable" BOOLEAN NOT NULL DEFAULT true,
    "pcb_applicable" BOOLEAN NOT NULL DEFAULT true,
    "leave_policy_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "clinic_id" TEXT,
    "work_date" DATE NOT NULL,
    "clock_in_at" TIMESTAMP(3),
    "clock_out_at" TIMESTAMP(3),
    "scheduled_start" TIMESTAMP(3),
    "scheduled_end" TIMESTAMP(3),
    "status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "late_minutes" INTEGER,
    "early_out_minutes" INTEGER,
    "worked_minutes" INTEGER,
    "overtime_minutes" INTEGER NOT NULL DEFAULT 0,
    "overtime_approved" BOOLEAN NOT NULL DEFAULT false,
    "overtime_approved_by_staff_id" TEXT,
    "corrected_at" TIMESTAMP(3),
    "corrected_by_staff_id" TEXT,
    "correction_reason" TEXT,
    "original_clock_in_at" TIMESTAMP(3),
    "original_clock_out_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_policies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "carry_forward_days" INTEGER,
    "pro_rate_on_join" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_policy_entitlements" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "leave_policy_id" TEXT NOT NULL,
    "leave_type" "LeaveType" NOT NULL,
    "days_per_year" DECIMAL(5,1) NOT NULL,
    "paid" BOOLEAN NOT NULL DEFAULT true,
    "requires_attachment" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "leave_policy_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_balances" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "leave_type" "LeaveType" NOT NULL,
    "benefit_year" INTEGER NOT NULL,
    "entitled_days" DECIMAL(5,1) NOT NULL,
    "carried_in_days" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "adjustment_days" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "adjustment_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incentive_rules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rule_type" "IncentiveRuleType" NOT NULL,
    "clinic_id" TEXT,
    "staff_id" TEXT,
    "employment_type" "EmploymentType",
    "threshold_amount" DECIMAL(12,2),
    "flat_amount" DECIMAL(12,2),
    "percent_above" DECIMAL(6,3),
    "service_catalog_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "per_procedure_amount" DECIMAL(10,2),
    "per_procedure_percent" DECIMAL(6,3),
    "excluded_service_catalog_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_by_staff_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incentive_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incentive_runs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "clinic_id" TEXT,
    "period" DATE NOT NULL,
    "status" "IncentiveRunStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "calculated_at" TIMESTAMP(3),
    "approved_by_staff_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "total_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_by_staff_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incentive_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incentive_results" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "incentive_run_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "incentive_rule_id" TEXT NOT NULL,
    "rule_version" INTEGER NOT NULL,
    "rule_snapshot" JSONB NOT NULL,
    "basis_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "basis_count" INTEGER NOT NULL DEFAULT 0,
    "amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "calculation" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incentive_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_benefit_accounts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "benefit_year" INTEGER NOT NULL,
    "allowance" DECIMAL(10,2) NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_benefit_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_benefit_members" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "patient_id" TEXT,
    "allowance_override" DECIMAL(10,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_benefit_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_benefit_usages" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "member_id" TEXT,
    "invoice_id" TEXT,
    "used_at" DATE NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "notes" TEXT,
    "recorded_by_staff_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_benefit_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statutory_rule_sets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL DEFAULT 'MY',
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "verified_at" TIMESTAMP(3),
    "verified_by_staff_id" TEXT,
    "verification_note" TEXT,
    "epf_rules" JSONB,
    "socso_rules" JSONB,
    "eis_rules" JSONB,
    "pcb_rules" JSONB,
    "created_by_staff_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "statutory_rule_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "clinic_id" TEXT,
    "period" DATE NOT NULL,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "statutory_status" "StatutoryStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "statutory_rule_set_id" TEXT,
    "statutory_snapshot" JSONB,
    "gross_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "deduction_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "net_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "employer_cost_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "employee_count" INTEGER NOT NULL DEFAULT 0,
    "exceptions" JSONB,
    "calculated_at" TIMESTAMP(3),
    "approved_by_staff_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_by_staff_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "payroll_run_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "employee_snapshot" JSONB NOT NULL,
    "basic_salary" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "allowances" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "overtime_pay" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "incentives" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "bonus" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "gross_pay" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "unpaid_leave_deduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "other_deductions" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "epf_employee" DECIMAL(12,2),
    "epf_employer" DECIMAL(12,2),
    "socso_employee" DECIMAL(12,2),
    "socso_employer" DECIMAL(12,2),
    "eis_employee" DECIMAL(12,2),
    "eis_employer" DECIMAL(12,2),
    "pcb" DECIMAL(12,2),
    "net_pay" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "employer_cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "worked_days" DECIMAL(5,1),
    "unpaid_days" DECIMAL(5,1),
    "overtime_hours" DECIMAL(6,2),
    "breakdown" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_adjustments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "payroll_run_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_staff_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employee_profiles_staff_id_key" ON "employee_profiles"("staff_id");

-- CreateIndex
CREATE INDEX "employee_profiles_tenant_id_employment_status_idx" ON "employee_profiles"("tenant_id", "employment_status");

-- CreateIndex
CREATE UNIQUE INDEX "employee_profiles_tenant_id_employee_no_key" ON "employee_profiles"("tenant_id", "employee_no");

-- CreateIndex
CREATE INDEX "attendance_records_tenant_id_clinic_id_work_date_idx" ON "attendance_records"("tenant_id", "clinic_id", "work_date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_tenant_id_staff_id_work_date_key" ON "attendance_records"("tenant_id", "staff_id", "work_date");

-- CreateIndex
CREATE UNIQUE INDEX "leave_policies_tenant_id_name_key" ON "leave_policies"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "leave_policy_entitlements_leave_policy_id_leave_type_key" ON "leave_policy_entitlements"("leave_policy_id", "leave_type");

-- CreateIndex
CREATE INDEX "leave_balances_tenant_id_benefit_year_idx" ON "leave_balances"("tenant_id", "benefit_year");

-- CreateIndex
CREATE UNIQUE INDEX "leave_balances_tenant_id_staff_id_leave_type_benefit_year_key" ON "leave_balances"("tenant_id", "staff_id", "leave_type", "benefit_year");

-- CreateIndex
CREATE INDEX "incentive_rules_tenant_id_effective_from_idx" ON "incentive_rules"("tenant_id", "effective_from");

-- CreateIndex
CREATE INDEX "incentive_runs_tenant_id_period_idx" ON "incentive_runs"("tenant_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "incentive_runs_tenant_id_clinic_id_period_key" ON "incentive_runs"("tenant_id", "clinic_id", "period");

-- CreateIndex
CREATE INDEX "incentive_results_tenant_id_incentive_run_id_idx" ON "incentive_results"("tenant_id", "incentive_run_id");

-- CreateIndex
CREATE INDEX "incentive_results_tenant_id_staff_id_idx" ON "incentive_results"("tenant_id", "staff_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_benefit_accounts_tenant_id_staff_id_benefit_year_key" ON "staff_benefit_accounts"("tenant_id", "staff_id", "benefit_year");

-- CreateIndex
CREATE INDEX "staff_benefit_members_tenant_id_account_id_idx" ON "staff_benefit_members"("tenant_id", "account_id");

-- CreateIndex
CREATE INDEX "staff_benefit_usages_tenant_id_account_id_used_at_idx" ON "staff_benefit_usages"("tenant_id", "account_id", "used_at");

-- CreateIndex
CREATE INDEX "statutory_rule_sets_tenant_id_effective_from_idx" ON "statutory_rule_sets"("tenant_id", "effective_from");

-- CreateIndex
CREATE INDEX "payroll_runs_tenant_id_period_idx" ON "payroll_runs"("tenant_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_tenant_id_clinic_id_period_key" ON "payroll_runs"("tenant_id", "clinic_id", "period");

-- CreateIndex
CREATE INDEX "payroll_lines_tenant_id_payroll_run_id_idx" ON "payroll_lines"("tenant_id", "payroll_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_lines_payroll_run_id_staff_id_key" ON "payroll_lines"("payroll_run_id", "staff_id");

-- CreateIndex
CREATE INDEX "payroll_adjustments_tenant_id_payroll_run_id_idx" ON "payroll_adjustments"("tenant_id", "payroll_run_id");

-- AddForeignKey
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_manager_staff_id_fkey" FOREIGN KEY ("manager_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_leave_policy_id_fkey" FOREIGN KEY ("leave_policy_id") REFERENCES "leave_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_corrected_by_staff_id_fkey" FOREIGN KEY ("corrected_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_overtime_approved_by_staff_id_fkey" FOREIGN KEY ("overtime_approved_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_policies" ADD CONSTRAINT "leave_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_policy_entitlements" ADD CONSTRAINT "leave_policy_entitlements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_policy_entitlements" ADD CONSTRAINT "leave_policy_entitlements_leave_policy_id_fkey" FOREIGN KEY ("leave_policy_id") REFERENCES "leave_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_rules" ADD CONSTRAINT "incentive_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_rules" ADD CONSTRAINT "incentive_rules_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_rules" ADD CONSTRAINT "incentive_rules_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_rules" ADD CONSTRAINT "incentive_rules_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_runs" ADD CONSTRAINT "incentive_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_runs" ADD CONSTRAINT "incentive_runs_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_runs" ADD CONSTRAINT "incentive_runs_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_runs" ADD CONSTRAINT "incentive_runs_approved_by_staff_id_fkey" FOREIGN KEY ("approved_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_results" ADD CONSTRAINT "incentive_results_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_results" ADD CONSTRAINT "incentive_results_incentive_run_id_fkey" FOREIGN KEY ("incentive_run_id") REFERENCES "incentive_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_results" ADD CONSTRAINT "incentive_results_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_results" ADD CONSTRAINT "incentive_results_incentive_rule_id_fkey" FOREIGN KEY ("incentive_rule_id") REFERENCES "incentive_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_benefit_accounts" ADD CONSTRAINT "staff_benefit_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_benefit_accounts" ADD CONSTRAINT "staff_benefit_accounts_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_benefit_members" ADD CONSTRAINT "staff_benefit_members_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_benefit_members" ADD CONSTRAINT "staff_benefit_members_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "staff_benefit_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_benefit_members" ADD CONSTRAINT "staff_benefit_members_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_benefit_usages" ADD CONSTRAINT "staff_benefit_usages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_benefit_usages" ADD CONSTRAINT "staff_benefit_usages_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "staff_benefit_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_benefit_usages" ADD CONSTRAINT "staff_benefit_usages_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "staff_benefit_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_benefit_usages" ADD CONSTRAINT "staff_benefit_usages_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_benefit_usages" ADD CONSTRAINT "staff_benefit_usages_recorded_by_staff_id_fkey" FOREIGN KEY ("recorded_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statutory_rule_sets" ADD CONSTRAINT "statutory_rule_sets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statutory_rule_sets" ADD CONSTRAINT "statutory_rule_sets_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statutory_rule_sets" ADD CONSTRAINT "statutory_rule_sets_verified_by_staff_id_fkey" FOREIGN KEY ("verified_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_approved_by_staff_id_fkey" FOREIGN KEY ("approved_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_payroll_run_id_fkey" FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_payroll_run_id_fkey" FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- ROW-LEVEL SECURITY.
--
-- Payroll and employee tables carry the most sensitive data in the schema —
-- salaries, bank accounts, IC numbers. Every one of them is scoped, and
-- FORCE means the migration-running owner is bound too.
-- ---------------------------------------------------------------------------
ALTER TABLE "employee_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employee_profiles" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "employee_profiles"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "attendance_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendance_records" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "attendance_records"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "leave_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_policies" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "leave_policies"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "leave_policy_entitlements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_policy_entitlements" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "leave_policy_entitlements"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "leave_balances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_balances" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "leave_balances"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "incentive_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incentive_rules" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "incentive_rules"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "incentive_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incentive_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "incentive_runs"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "incentive_results" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "incentive_results" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "incentive_results"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "staff_benefit_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_benefit_accounts" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "staff_benefit_accounts"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "staff_benefit_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_benefit_members" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "staff_benefit_members"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "staff_benefit_usages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_benefit_usages" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "staff_benefit_usages"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "statutory_rule_sets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "statutory_rule_sets" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "statutory_rule_sets"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "payroll_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payroll_runs"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "payroll_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payroll_lines"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "payroll_adjustments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_adjustments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payroll_adjustments"
  USING (tenant_id = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------------
-- A LOCKED PAYROLL RUN IS IMMUTABLE.
--
-- Owner brief §5I: "Payroll run must be immutable once locked except through
-- controlled adjustment." That is enforced here rather than only in the
-- service, because payroll is the one place where a bug that silently rewrites
-- a past figure would be discovered by an employee rather than by a test.
--
-- Once a run is APPROVED or PAID, its LINES cannot change at all, and the run
-- itself may only move APPROVED → PAID (and record who paid it). A correction
-- is a `payroll_adjustments` row, which appears on the next payslip with its
-- actor and its reason.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION payroll_lines_locked() RETURNS TRIGGER AS $$
DECLARE
  run_status text;
BEGIN
  SELECT status::text INTO run_status FROM "payroll_runs"
   WHERE id = COALESCE(NEW.payroll_run_id, OLD.payroll_run_id);

  IF run_status IN ('APPROVED', 'PAID') THEN
    RAISE EXCEPTION 'payroll run is locked: correct it with a payroll adjustment, not by editing a payslip line';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payroll_lines_locked_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON "payroll_lines"
  FOR EACH ROW EXECUTE FUNCTION payroll_lines_locked();

CREATE OR REPLACE FUNCTION payroll_runs_locked() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status NOT IN ('APPROVED', 'PAID') THEN
    RETURN NEW;
  END IF;

  -- The one permitted transition after locking, plus its two stamps.
  IF OLD.status = 'APPROVED' AND NEW.status = 'PAID'
     AND NEW.gross_total = OLD.gross_total
     AND NEW.net_total = OLD.net_total
     AND NEW.deduction_total = OLD.deduction_total
     AND NEW.employer_cost_total = OLD.employer_cost_total
     AND NEW.statutory_status = OLD.statutory_status THEN
    RETURN NEW;
  END IF;

  -- Cancelling a locked run is a deliberate, recorded act and stays available;
  -- it changes no figure.
  IF NEW.status = 'CANCELLED'
     AND NEW.gross_total = OLD.gross_total
     AND NEW.net_total = OLD.net_total THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'payroll run is locked: an approved run''s figures cannot change — record a payroll adjustment instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payroll_runs_locked_trigger
  BEFORE UPDATE ON "payroll_runs"
  FOR EACH ROW EXECUTE FUNCTION payroll_runs_locked();

-- Adjustments are the correction mechanism, so they are themselves a record
-- that must not be rewritten.
CREATE OR REPLACE FUNCTION payroll_adjustments_append_only() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'payroll_adjustments is append-only: reverse an adjustment with another adjustment';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payroll_adjustments_append_only_trigger
  BEFORE UPDATE OR DELETE ON "payroll_adjustments"
  FOR EACH ROW EXECUTE FUNCTION payroll_adjustments_append_only();

REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "payroll_adjustments" FROM PUBLIC;

-- Sanity constraints on money and time.
ALTER TABLE "attendance_records" ADD CONSTRAINT attendance_minutes_not_negative
  CHECK (
    (worked_minutes IS NULL OR worked_minutes >= 0)
    AND (late_minutes IS NULL OR late_minutes >= 0)
    AND (early_out_minutes IS NULL OR early_out_minutes >= 0)
    AND overtime_minutes >= 0
  );

ALTER TABLE "leave_policy_entitlements" ADD CONSTRAINT leave_entitlement_days_not_negative
  CHECK (days_per_year >= 0);

ALTER TABLE "staff_benefit_accounts" ADD CONSTRAINT staff_benefit_allowance_not_negative
  CHECK (allowance >= 0);

ALTER TABLE "staff_benefit_usages" ADD CONSTRAINT staff_benefit_usage_positive
  CHECK (amount > 0);

-- An incentive rule's effective window must be a window.
ALTER TABLE "incentive_rules" ADD CONSTRAINT incentive_rules_window_ordered
  CHECK (effective_to IS NULL OR effective_to >= effective_from);

ALTER TABLE "statutory_rule_sets" ADD CONSTRAINT statutory_rule_sets_window_ordered
  CHECK (effective_to IS NULL OR effective_to >= effective_from);
