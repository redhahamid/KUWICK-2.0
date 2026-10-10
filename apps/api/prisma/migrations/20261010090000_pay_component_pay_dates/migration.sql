-- WHEN EACH PAYROLL ITEM IS PAID.
--
-- One payroll month can be paid on more than one date: salary on the 30th,
-- a director's fee on the 1st of the next month, overtime and claims on the
-- 15th of the next month. Each item now says when it is paid, as a day of
-- the month and whether that day falls in the payroll month (0) or the month
-- after it (1). Statutory figures and payslips stay on the whole payroll
-- month; only the transfer is split by date.
--
-- Every existing item becomes "30th of the payroll month", which is one date
-- for the whole month, so every run, payment listing and figure stays as it
-- is until a clinic changes a date in Settings. Two columns with defaults and
-- two checks; no data statement and no new table, so the application role's
-- existing table grants already cover them.
ALTER TABLE "pay_components" ADD COLUMN "pay_day" SMALLINT NOT NULL DEFAULT 30;
ALTER TABLE "pay_components" ADD COLUMN "pay_month_offset" SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE "pay_components" ADD CONSTRAINT "pay_components_pay_day_check" CHECK ("pay_day" BETWEEN 1 AND 31);
ALTER TABLE "pay_components" ADD CONSTRAINT "pay_components_pay_month_offset_check" CHECK ("pay_month_offset" IN (0, 1));
