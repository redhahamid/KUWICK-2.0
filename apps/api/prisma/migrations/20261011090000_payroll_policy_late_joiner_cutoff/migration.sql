-- Late joiners paid the next month (UAT, 10 October 2026). Null keeps
-- today's behaviour for every rule set: a joiner's part month is paid in it.
ALTER TABLE "payroll_policies" ADD COLUMN "late_joiner_cutoff_day" SMALLINT;
