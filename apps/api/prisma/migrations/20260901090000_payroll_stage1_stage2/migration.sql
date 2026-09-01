-- MALAYSIA HR & PAYROLL — STAGE 1 + STAGE 2 (structural)
--
-- ADDITIVE ONLY. No column is dropped, no data is destroyed, and no figure any
-- existing payroll produces changes. `employee_profiles.basic_salary` stays in
-- place and stays read until a full period has run on `employee_salaries`.
--
-- NOTHING HERE ESTABLISHES A STATUTORY RULE. Every statutory flag on
-- `pay_components` is seeded to reproduce today's behaviour exactly and ships
-- DRAFT (= UNVERIFIED in the register). Which values are correct is Stage 3 and
-- is blocked on KWSP, PERKESO, HASiL, HRD Corp and JTKSM.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE "SalaryBasis" AS ENUM ('MONTHLY', 'DAILY', 'HOURLY');
CREATE TYPE "PayComponentType" AS ENUM ('ADDITION', 'DEDUCTION', 'OVERTIME');
CREATE TYPE "PayComponentCategory" AS ENUM ('REMUNERATION', 'ALLOWANCE', 'BENEFIT_IN_KIND', 'PERQUISITE', 'TAX_DEDUCTION', 'PAYROLL_DEDUCTION');
CREATE TYPE "PayComponentIncludeIn" AS ENUM ('GROSS_AND_NET', 'GROSS_ONLY', 'NET_ONLY', 'NONE');
CREATE TYPE "PayComponentCalculationMode" AS ENUM ('AMOUNT', 'PER_UNIT');
CREATE TYPE "ProrationBasis" AS ENUM ('FIXED_DAYS', 'WORKING_DAYS', 'CALENDAR_DAYS');
CREATE TYPE "PayrollInputSource" AS ENUM ('MANUAL', 'ATTENDANCE', 'LEAVE', 'CLAIM', 'INCENTIVE', 'RECURRING', 'IMPORT');
CREATE TYPE "PayrollInputKind" AS ENUM ('RECURRING', 'ADDITIONAL');
CREATE TYPE "PayrollRunType" AS ENUM ('REGULAR', 'OFF_CYCLE_BONUS', 'CORRECTION', 'FINAL_PAY');
CREATE TYPE "PayrollExceptionSeverity" AS ENUM ('BLOCKING', 'WARNING', 'INFO');
CREATE TYPE "YtdSource" AS ENUM ('CALCULATED', 'OPENING_IMPORT');

-- ---------------------------------------------------------------------------
-- 1. LEGAL EMPLOYER — the entity that employs, files and pays.
-- ---------------------------------------------------------------------------
CREATE TABLE "legal_employers" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "registration_no" TEXT,
  "epf_employer_no" TEXT,
  "socso_employer_no" TEXT,
  "lhdn_employer_no" TEXT,
  "hrd_registration_no" TEXT,
  "hrd_category" TEXT,
  "hrd_levy_rate" DECIMAL(5,4),
  "address_line1" TEXT,
  "address_line2" TEXT,
  "postcode" TEXT,
  "city" TEXT,
  "state" TEXT,
  "bank_name" TEXT,
  "bank_account_no" TEXT,
  "bank_account_name" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "legal_employers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "legal_employers_tenant_id_name_key" ON "legal_employers"("tenant_id", "name");
CREATE INDEX "legal_employers_tenant_id_active_idx" ON "legal_employers"("tenant_id", "active");
ALTER TABLE "legal_employers"
  ADD CONSTRAINT "legal_employers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 2. EFFECTIVE-DATED SALARY
-- ---------------------------------------------------------------------------
CREATE TABLE "employee_salaries" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "staff_id" TEXT NOT NULL,
  "basis" "SalaryBasis" NOT NULL DEFAULT 'MONTHLY',
  "amount" DECIMAL(12,2) NOT NULL,
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "reason" TEXT,
  "note" TEXT,
  "created_by_staff_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employee_salaries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "employee_salaries_staff_id_effective_from_key" ON "employee_salaries"("staff_id", "effective_from");
CREATE INDEX "employee_salaries_tenant_id_staff_id_effective_from_idx" ON "employee_salaries"("tenant_id", "staff_id", "effective_from");
ALTER TABLE "employee_salaries"
  ADD CONSTRAINT "employee_salaries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "employee_salaries_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "employee_salaries_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A salary row must not start before it ends.
ALTER TABLE "employee_salaries"
  ADD CONSTRAINT "employee_salaries_period_ordered"
  CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from");

-- ---------------------------------------------------------------------------
-- 3. PAY COMPONENTS — twelve independent attributes, as configuration.
-- ---------------------------------------------------------------------------
CREATE TABLE "pay_components" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "PayComponentType" NOT NULL,
  "category" "PayComponentCategory" NOT NULL,
  "calculation_mode" "PayComponentCalculationMode" NOT NULL DEFAULT 'AMOUNT',
  "include_in" "PayComponentIncludeIn" NOT NULL DEFAULT 'GROSS_AND_NET',
  "pcb_liable" BOOLEAN NOT NULL DEFAULT true,
  "epf_liable" BOOLEAN NOT NULL DEFAULT false,
  "socso_liable" BOOLEAN NOT NULL DEFAULT false,
  "eis_liable" BOOLEAN NOT NULL DEFAULT false,
  "hrd_liable" BOOLEAN NOT NULL DEFAULT false,
  "include_in_orp_base" BOOLEAN NOT NULL DEFAULT false,
  "include_in_unpaid_leave_base" BOOLEAN NOT NULL DEFAULT false,
  "additional_remuneration" BOOLEAN NOT NULL DEFAULT false,
  "pcb_exemption_limit_cents" INTEGER,
  "ea_field" TEXT,
  "prorated" BOOLEAN NOT NULL DEFAULT false,
  "employer_side" BOOLEAN NOT NULL DEFAULT false,
  "system_controlled" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "verification_status" "StatutoryVerificationStatus" NOT NULL DEFAULT 'DRAFT',
  "source_ref" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "created_by_staff_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pay_components_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "pay_components_tenant_id_code_effective_from_key" ON "pay_components"("tenant_id", "code", "effective_from");
CREATE INDEX "pay_components_tenant_id_active_idx" ON "pay_components"("tenant_id", "active");
ALTER TABLE "pay_components"
  ADD CONSTRAINT "pay_components_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Overtime must never enter the base that prices overtime.
ALTER TABLE "pay_components"
  ADD CONSTRAINT "pay_components_overtime_not_in_orp_base"
  CHECK (NOT ("type" = 'OVERTIME' AND "include_in_orp_base"));

-- ---------------------------------------------------------------------------
-- 4. PAYROLL POLICY — five independent proration bases.
-- ---------------------------------------------------------------------------
CREATE TABLE "payroll_policies" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "legal_employer_id" TEXT,
  "name" TEXT NOT NULL,
  "salary_proration_basis" "ProrationBasis" NOT NULL DEFAULT 'CALENDAR_DAYS',
  "salary_proration_days" INTEGER NOT NULL DEFAULT 26,
  "overtime_basis" "ProrationBasis" NOT NULL DEFAULT 'FIXED_DAYS',
  "overtime_days" INTEGER NOT NULL DEFAULT 26,
  "overtime_hours_per_day" DECIMAL(4,2) NOT NULL DEFAULT 7.5,
  "unpaid_leave_basis" "ProrationBasis" NOT NULL DEFAULT 'CALENDAR_DAYS',
  "unpaid_leave_days" INTEGER NOT NULL DEFAULT 31,
  "leave_pay_basis" "ProrationBasis" NOT NULL DEFAULT 'FIXED_DAYS',
  "leave_pay_days" INTEGER NOT NULL DEFAULT 26,
  "termination_basis" "ProrationBasis" NOT NULL DEFAULT 'CALENDAR_DAYS',
  "termination_days" INTEGER NOT NULL DEFAULT 31,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payroll_policies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payroll_policies_tenant_id_name_key" ON "payroll_policies"("tenant_id", "name");
CREATE INDEX "payroll_policies_tenant_id_legal_employer_id_idx" ON "payroll_policies"("tenant_id", "legal_employer_id");
ALTER TABLE "payroll_policies"
  ADD CONSTRAINT "payroll_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_policies_legal_employer_id_fkey" FOREIGN KEY ("legal_employer_id") REFERENCES "legal_employers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Day counts must be usable as divisors.
ALTER TABLE "payroll_policies"
  ADD CONSTRAINT "payroll_policies_days_positive"
  CHECK ("salary_proration_days" > 0 AND "overtime_days" > 0 AND "unpaid_leave_days" > 0
     AND "leave_pay_days" > 0 AND "termination_days" > 0 AND "overtime_hours_per_day" > 0);

-- ---------------------------------------------------------------------------
-- 5. RECURRING ITEMS
-- ---------------------------------------------------------------------------
CREATE TABLE "employee_recurring_items" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "staff_id" TEXT NOT NULL,
  "component_code" TEXT NOT NULL,
  "label" TEXT,
  "amount" DECIMAL(12,2) NOT NULL,
  "effective_from" DATE NOT NULL,
  "effective_to" DATE,
  "note" TEXT,
  "created_by_staff_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "employee_recurring_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "employee_recurring_items_staff_component_from_key" ON "employee_recurring_items"("staff_id", "component_code", "effective_from");
CREATE INDEX "employee_recurring_items_tenant_id_staff_id_idx" ON "employee_recurring_items"("tenant_id", "staff_id");
ALTER TABLE "employee_recurring_items"
  ADD CONSTRAINT "employee_recurring_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "employee_recurring_items_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "employee_recurring_items_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 6. APPROVED SNAPSHOT
-- ---------------------------------------------------------------------------
CREATE TABLE "payroll_snapshots" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "payroll_run_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "hash" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "reason" TEXT,
  "created_by_staff_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payroll_snapshots_payroll_run_id_version_key" ON "payroll_snapshots"("payroll_run_id", "version");
CREATE INDEX "payroll_snapshots_tenant_id_payroll_run_id_idx" ON "payroll_snapshots"("tenant_id", "payroll_run_id");
ALTER TABLE "payroll_snapshots"
  ADD CONSTRAINT "payroll_snapshots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_snapshots_payroll_run_id_fkey" FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_snapshots_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A SNAPSHOT IS IMMUTABLE. Not by convention — by refusal.
CREATE OR REPLACE FUNCTION payroll_snapshot_is_immutable() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'A payroll snapshot cannot be % once written. Approve again to add a new version.',
    lower(TG_OP);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payroll_snapshots_no_update
  BEFORE UPDATE OR DELETE ON "payroll_snapshots"
  FOR EACH ROW EXECUTE FUNCTION payroll_snapshot_is_immutable();

-- ---------------------------------------------------------------------------
-- 7. EXCEPTIONS AS ROWS
-- ---------------------------------------------------------------------------
CREATE TABLE "payroll_exceptions" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "payroll_run_id" TEXT NOT NULL,
  "staff_id" TEXT,
  "severity" "PayrollExceptionSeverity" NOT NULL,
  "code" TEXT NOT NULL,
  "cause" TEXT NOT NULL,
  "consequence" TEXT NOT NULL,
  "remediation" TEXT NOT NULL,
  "deep_link" TEXT,
  "overridable" BOOLEAN NOT NULL DEFAULT false,
  "overridden_by_staff_id" TEXT,
  "override_reason" TEXT,
  "overridden_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payroll_exceptions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "payroll_exceptions_tenant_run_severity_idx" ON "payroll_exceptions"("tenant_id", "payroll_run_id", "severity");
ALTER TABLE "payroll_exceptions"
  ADD CONSTRAINT "payroll_exceptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_exceptions_payroll_run_id_fkey" FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_exceptions_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_exceptions_overridden_by_staff_id_fkey" FOREIGN KEY ("overridden_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- An override without an actor and a reason is not an override, it is a bypass.
ALTER TABLE "payroll_exceptions"
  ADD CONSTRAINT "payroll_exceptions_override_is_accountable"
  CHECK (
    ("overridden_by_staff_id" IS NULL AND "override_reason" IS NULL AND "overridden_at" IS NULL)
    OR ("overridden_by_staff_id" IS NOT NULL AND "override_reason" IS NOT NULL AND "overridden_at" IS NOT NULL AND "overridable")
  );

-- ---------------------------------------------------------------------------
-- 8. YEAR TO DATE — substrate only. No calculation reads it in this stage.
-- ---------------------------------------------------------------------------
CREATE TABLE "employee_ytd" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "legal_employer_id" TEXT NOT NULL,
  "staff_id" TEXT NOT NULL,
  "tax_year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "gross_cents" INTEGER NOT NULL DEFAULT 0,
  "additional_remuneration_cents" INTEGER NOT NULL DEFAULT 0,
  "pcb_cents" INTEGER NOT NULL DEFAULT 0,
  "cp38_cents" INTEGER NOT NULL DEFAULT 0,
  "zakat_cents" INTEGER NOT NULL DEFAULT 0,
  "epf_employee_cents" INTEGER NOT NULL DEFAULT 0,
  "epf_employer_cents" INTEGER NOT NULL DEFAULT 0,
  "socso_employee_cents" INTEGER NOT NULL DEFAULT 0,
  "socso_employer_cents" INTEGER NOT NULL DEFAULT 0,
  "eis_employee_cents" INTEGER NOT NULL DEFAULT 0,
  "eis_employer_cents" INTEGER NOT NULL DEFAULT 0,
  "lindung_employee_cents" INTEGER NOT NULL DEFAULT 0,
  "lindung_employer_cents" INTEGER NOT NULL DEFAULT 0,
  "source" "YtdSource" NOT NULL DEFAULT 'CALCULATED',
  "payroll_run_id" TEXT,
  "note" TEXT,
  "created_by_staff_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "employee_ytd_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "employee_ytd_employer_staff_year_month_key" ON "employee_ytd"("legal_employer_id", "staff_id", "tax_year", "month");
CREATE INDEX "employee_ytd_tenant_id_staff_id_tax_year_idx" ON "employee_ytd"("tenant_id", "staff_id", "tax_year");
ALTER TABLE "employee_ytd"
  ADD CONSTRAINT "employee_ytd_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "employee_ytd_legal_employer_id_fkey" FOREIGN KEY ("legal_employer_id") REFERENCES "legal_employers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "employee_ytd_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "employee_ytd_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "employee_ytd"
  ADD CONSTRAINT "employee_ytd_month_valid" CHECK ("month" BETWEEN 1 AND 12);

-- ---------------------------------------------------------------------------
-- 9. ADDITIVE COLUMNS ON EXISTING TABLES
-- ---------------------------------------------------------------------------
ALTER TABLE "employee_profiles"
  ADD COLUMN "legal_employer_id" TEXT,
  ADD COLUMN "payroll_policy_id" TEXT,
  ADD COLUMN "residential_status" TEXT;
ALTER TABLE "employee_profiles"
  ADD CONSTRAINT "employee_profiles_legal_employer_id_fkey" FOREIGN KEY ("legal_employer_id") REFERENCES "legal_employers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "employee_profiles_payroll_policy_id_fkey" FOREIGN KEY ("payroll_policy_id") REFERENCES "payroll_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payroll_runs"
  ADD COLUMN "legal_employer_id" TEXT,
  ADD COLUMN "run_type" "PayrollRunType" NOT NULL DEFAULT 'REGULAR',
  ADD COLUMN "sequence" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "payment_date" DATE;
ALTER TABLE "payroll_runs"
  ADD CONSTRAINT "payroll_runs_legal_employer_id_fkey" FOREIGN KEY ("legal_employer_id") REFERENCES "legal_employers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One run per branch per month could not represent a clinic paying on three
-- dates, a bonus run, a correction or a final payment. Strictly more permissive
-- than the constraint it replaces: every existing row remains valid.
DROP INDEX IF EXISTS "payroll_runs_tenant_id_clinic_id_period_key";
ALTER TABLE "payroll_runs" DROP CONSTRAINT IF EXISTS "payroll_runs_tenant_id_clinic_id_period_key";
CREATE UNIQUE INDEX "payroll_runs_tenant_clinic_period_type_seq_key"
  ON "payroll_runs"("tenant_id", "clinic_id", "period", "run_type", "sequence");
CREATE INDEX "payroll_runs_tenant_id_legal_employer_id_period_idx"
  ON "payroll_runs"("tenant_id", "legal_employer_id", "period");

ALTER TABLE "payroll_input_entries"
  ADD COLUMN "source" "PayrollInputSource" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "source_record_id" TEXT,
  ADD COLUMN "kind" "PayrollInputKind" NOT NULL DEFAULT 'ADDITIONAL',
  ADD COLUMN "reason" TEXT;

-- A materialised upstream input is idempotent on its source record. Two
-- imports of the same attendance row must not pay somebody twice.
CREATE UNIQUE INDEX "payroll_input_entries_source_record_key"
  ON "payroll_input_entries"("tenant_id", "staff_id", "period", "component_code", "source_record_id")
  WHERE "source_record_id" IS NOT NULL;

-- A derived input must say where it came from.
ALTER TABLE "payroll_input_entries"
  ADD CONSTRAINT "payroll_input_entries_derived_has_source"
  CHECK ("source" IN ('MANUAL', 'IMPORT') OR "source_record_id" IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 10. ROW LEVEL SECURITY — every new table, no exceptions.
-- ---------------------------------------------------------------------------
ALTER TABLE "legal_employers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "legal_employers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "legal_employers"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "employee_salaries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employee_salaries" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "employee_salaries"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "pay_components" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pay_components" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pay_components"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "payroll_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_policies" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payroll_policies"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "employee_recurring_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employee_recurring_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "employee_recurring_items"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "payroll_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_snapshots" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payroll_snapshots"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "payroll_exceptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_exceptions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payroll_exceptions"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "employee_ytd" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employee_ytd" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "employee_ytd"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------------
-- 10b. THE LOCK, TAUGHT TWO NEW MOVES.
--
-- `payroll_runs_locked()` refused EVERY update to an approved run except the
-- PAID transition and cancellation. That was right when the only way to change
-- a locked run was an adjustment. Two things now need to pass it, and both
-- were found by the integration suite rather than by reading the code:
--
--   1. A REOPEN (APPROVED -> CALCULATED). Permitted only when a snapshot of
--      what was approved already exists — you may unlock only what has been
--      frozen, so reopening can never lose the record of what was paid. The
--      service also demands a reason and the `hr.payroll.reopen` permission;
--      this is the floor beneath both.
--
--   2. STAMPING NON-FINANCIAL METADATA on a locked run — the employer it
--      belongs to, its payment date — where no figure moves. The backfill in
--      section 11 does exactly this, and the old trigger refused it.
--
-- Every figure stays as protected as it was: gross, net, deduction, employer
-- cost and statutory status must all be unchanged on any path except a fresh
-- calculation of an unlocked run.
-- ---------------------------------------------------------------------------
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

  -- REOPEN. Only from APPROVED, only back to CALCULATED, only when what was
  -- approved has been snapshotted, and only with every figure still untouched
  -- at the moment of unlocking.
  IF OLD.status = 'APPROVED' AND NEW.status = 'CALCULATED'
     AND NEW.gross_total = OLD.gross_total
     AND NEW.net_total = OLD.net_total
     AND NEW.deduction_total = OLD.deduction_total
     AND NEW.employer_cost_total = OLD.employer_cost_total
     AND EXISTS (SELECT 1 FROM "payroll_snapshots" ps WHERE ps."payroll_run_id" = OLD.id) THEN
    RETURN NEW;
  END IF;

  -- Non-financial metadata on a locked run: same status, same every figure.
  IF NEW.status = OLD.status
     AND NEW.gross_total = OLD.gross_total
     AND NEW.net_total = OLD.net_total
     AND NEW.deduction_total = OLD.deduction_total
     AND NEW.employer_cost_total = OLD.employer_cost_total
     AND NEW.employee_count = OLD.employee_count
     AND NEW.statutory_status = OLD.statutory_status THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'payroll run is locked: an approved run''s figures cannot change — record a payroll adjustment instead';
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 11. BACKFILL — reproduce today's state exactly.
--
-- One employer per tenant, named from the tenant. Every employee and every
-- historical payroll run is assigned to it. This is a structural assignment,
-- not a business decision: a clinic group that genuinely runs several Sdn Bhds
-- splits them afterwards through the UI, and until it does, nothing about the
-- numbers changes.
-- ---------------------------------------------------------------------------
INSERT INTO "legal_employers" ("id", "tenant_id", "name", "active", "created_at", "updated_at")
SELECT gen_random_uuid()::text, t."id", t."name", true, now(), now()
FROM "tenants" t
WHERE NOT EXISTS (SELECT 1 FROM "legal_employers" le WHERE le."tenant_id" = t."id");

UPDATE "employee_profiles" ep
   SET "legal_employer_id" = le."id"
  FROM "legal_employers" le
 WHERE le."tenant_id" = ep."tenant_id" AND ep."legal_employer_id" IS NULL;

UPDATE "payroll_runs" pr
   SET "legal_employer_id" = le."id"
  FROM "legal_employers" le
 WHERE le."tenant_id" = pr."tenant_id" AND pr."legal_employer_id" IS NULL;

-- Salary history: the current basic salary becomes the first row, effective
-- from the employee's start date, or from the epoch where none is recorded, so
-- that resolving a salary for ANY historical period finds exactly this figure.
-- Nothing reads this table yet; the parity check does.
INSERT INTO "employee_salaries" ("id", "tenant_id", "staff_id", "basis", "amount", "effective_from", "reason", "created_by_staff_id", "created_at")
SELECT gen_random_uuid()::text,
       ep."tenant_id",
       ep."staff_id",
       'MONTHLY'::"SalaryBasis",
       ep."basic_salary",
       COALESCE(ep."start_date", DATE '1970-01-01'),
       'Backfilled from the employee record when effective-dated salary was introduced.',
       ep."staff_id",
       now()
FROM "employee_profiles" ep
WHERE ep."basic_salary" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "employee_salaries" es WHERE es."staff_id" = ep."staff_id");

-- Hourly staff carry an hourly rate instead.
INSERT INTO "employee_salaries" ("id", "tenant_id", "staff_id", "basis", "amount", "effective_from", "reason", "created_by_staff_id", "created_at")
SELECT gen_random_uuid()::text,
       ep."tenant_id",
       ep."staff_id",
       'HOURLY'::"SalaryBasis",
       ep."hourly_rate",
       COALESCE(ep."start_date", DATE '1970-01-01'),
       'Backfilled from the employee record when effective-dated salary was introduced.',
       ep."staff_id",
       now()
FROM "employee_profiles" ep
WHERE ep."basic_salary" IS NULL
  AND ep."hourly_rate" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "employee_salaries" es WHERE es."staff_id" = ep."staff_id");

-- Existing exceptions move from the run's JSON blob into rows, so they can be
-- counted, filtered and overridden. Severity is BLOCKING because that is what
-- the old behaviour was: any exception blocked approval.
INSERT INTO "payroll_exceptions" ("id", "tenant_id", "payroll_run_id", "staff_id", "severity", "code", "cause", "consequence", "remediation", "created_at")
SELECT gen_random_uuid()::text,
       pr."tenant_id",
       pr."id",
       NULLIF(e->>'staffId', ''),
       'BLOCKING'::"PayrollExceptionSeverity",
       'LEGACY',
       COALESCE(e->>'issue', 'Unspecified'),
       'This run cannot be approved until the issue is resolved.',
       'Resolve the underlying data and recalculate the run.',
       now()
FROM "payroll_runs" pr
CROSS JOIN LATERAL jsonb_array_elements(pr."exceptions") AS e
WHERE pr."exceptions" IS NOT NULL
  AND jsonb_typeof(pr."exceptions") = 'array';
