-- How far a rate set has been checked. Only VERIFIED lets a payroll run be
-- approved, and it means a person compared the authority's published schedule.
CREATE TYPE "StatutoryVerificationStatus" AS ENUM ('DRAFT', 'CORROBORATED', 'VERIFIED');

ALTER TABLE "statutory_rule_sets"
  ADD COLUMN "verification_status" "StatutoryVerificationStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "source_url" TEXT;

-- Existing rows that a person had already marked verified keep that meaning.
UPDATE "statutory_rule_sets" SET "verification_status" = 'VERIFIED' WHERE "verified_at" IS NOT NULL;

-- The employee's elected EPF share: 11 (statutory) or 9 (reduced). It selects
-- between two different Third Schedule tables, so it is an election and not a
-- percentage this system multiplies by.
ALTER TABLE "employee_profiles"
  ADD COLUMN "epf_employee_rate" DECIMAL(4,2) DEFAULT 11;

-- Ordinary Rate of Pay divisors, frozen onto the run. Clinic policy, not law,
-- and two different day counts on purpose: overtime is priced on a 26-day
-- month, unpaid leave is deducted on a 31-day one.
ALTER TABLE "payroll_runs"
  ADD COLUMN "orp_overtime_days"     DECIMAL(4,1) NOT NULL DEFAULT 26,
  ADD COLUMN "orp_unpaid_leave_days" DECIMAL(4,1) NOT NULL DEFAULT 31,
  ADD COLUMN "orp_hours_per_day"     DECIMAL(4,2) NOT NULL DEFAULT 7.5;
