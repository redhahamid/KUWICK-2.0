-- HOW EXTRA HOURS, REST DAYS AND PUBLIC HOLIDAYS ARE PRICED — per rule set.
--
-- Every run priced them one way: the Employment Act's arithmetic (a day is
-- the monthly wage over 26, an hour is a day over the normal hours; 1.5× on a
-- normal day, two days' wages for a public holiday, s.60(3) for a rest day).
-- That is right for everybody the First Schedule reaches — wages of RM4,000 a
-- month or less — and it is not how a clinic pays its doctors, who are above
-- the limit and paid a fixed sum per public-holiday shift or per session.
--
-- A rule set now says WHICH of the two it uses:
--
--   STATUTORY    — the Act's formula, exactly as before. The default, so no
--                  existing policy changes what it computes.
--   CLINIC_RATE  — fixed amounts, set here and never typed into the grid:
--                  RM per hour of approved overtime, RM per public-holiday
--                  shift, RM per rest-day shift, RM per session (a rest day or
--                  holiday worked for at most half the normal hours). A kind
--                  of day with no amount falls back to the Act's formula.
--
-- WHICH RULE SET AN EMPLOYEE IS ON. An employee assigned a policy directly
-- (employee_profiles.payroll_policy_id, already in the schema) is on that one.
-- Otherwise the rule set naming their workforce category (doctors, clinical
-- staff, admin, management, other — derived from the staff role, never
-- stored) applies; otherwise the tenant default; otherwise the Act.
--
-- THE FLOOR IS NOT CONFIGURABLE. For an employee within the First Schedule
-- the Act's rates are a minimum (s.60I(2)): a clinic rate below them is shown
-- as a warning in Settings and blocks the payroll run for that employee. That
-- is enforced in code against the month's actual days, not here.
--
-- NO BACKFILL. Every existing policy is STATUTORY with no rates, which is what
-- every run has done so far.

CREATE TYPE "OvertimeMode" AS ENUM ('STATUTORY', 'CLINIC_RATE');

ALTER TABLE "payroll_policies"
    ADD COLUMN "overtime_mode" "OvertimeMode" NOT NULL DEFAULT 'STATUTORY',
    ADD COLUMN "clinic_overtime_hourly" DECIMAL(12,2),
    ADD COLUMN "clinic_public_holiday_shift" DECIMAL(12,2),
    ADD COLUMN "clinic_rest_day_shift" DECIMAL(12,2),
    ADD COLUMN "clinic_session_rate" DECIMAL(12,2),
    ADD COLUMN "workforce_category" TEXT;

-- One rule set per workforce category, per employing company or tenant-wide.
-- Two rule sets both claiming "doctors" would leave the run to pick one, and
-- the two could price the same Sunday differently. Partial, because a rule set
-- with no category (the default, or one only assigned by hand) is unlimited.
CREATE UNIQUE INDEX "payroll_policies_tenant_category_key"
    ON "payroll_policies"("tenant_id", "workforce_category")
    WHERE "workforce_category" IS NOT NULL AND "legal_employer_id" IS NULL;
CREATE UNIQUE INDEX "payroll_policies_employer_category_key"
    ON "payroll_policies"("tenant_id", "legal_employer_id", "workforce_category")
    WHERE "workforce_category" IS NOT NULL AND "legal_employer_id" IS NOT NULL;
