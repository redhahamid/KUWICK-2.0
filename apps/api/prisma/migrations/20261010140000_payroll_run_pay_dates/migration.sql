-- THE OWNER'S PAY DATES FOR ONE RUN.
--
-- A payroll item's "Paid on" day is only the default date within the run's
-- month; the owner can move a date for one run on its Pay step until that
-- date's listing is prepared. The choices live on the run: the approved
-- record's default date to the date chosen.
--
-- One nullable column on an existing table: no data statement and no new
-- table, so the application role's existing grants on payroll_runs cover it.
ALTER TABLE "payroll_runs" ADD COLUMN "pay_dates" JSONB;
