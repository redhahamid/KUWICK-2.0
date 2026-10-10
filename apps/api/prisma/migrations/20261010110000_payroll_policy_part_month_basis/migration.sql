-- HOW A PART MONTH IS PAID, per rule set.
--
-- CALENDAR_DAYS is s.18A of the Employment Act and every rule set's answer
-- today, so the default moves nobody's pay. WORKING_DAYS is a clinic's own
-- choice. A fixed-day month is not one of the answers.
--
-- One column with a default and a check on an existing table: no data
-- statement and no new table, so the application role's existing grants on
-- payroll_policies already cover it.
ALTER TABLE "payroll_policies" ADD COLUMN "part_month_basis" "ProrationBasis" NOT NULL DEFAULT 'CALENDAR_DAYS';
ALTER TABLE "payroll_policies" ADD CONSTRAINT "payroll_policies_part_month_basis_check"
  CHECK ("part_month_basis" IN ('CALENDAR_DAYS', 'WORKING_DAYS'));
