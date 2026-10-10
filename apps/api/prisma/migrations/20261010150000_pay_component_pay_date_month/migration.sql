-- THE MONTH A PAY DATE FALLS IN (UAT, 10 October 2026): "of this month / of
-- the following month", e.g. salary paid on the 1st of the following month,
-- or the 25th of this month. 0 is the run's own month, which every item has
-- been until now; 1 is the month after it. Separate from pay_month_offset,
-- which says whose month's work the run pays (a month in arrears).
--
-- One column with a default on an existing table: no data statement and no
-- new table, so the application role's grants on pay_components cover it.
ALTER TABLE "pay_components" ADD COLUMN "pay_date_month_offset" SMALLINT NOT NULL DEFAULT 0;
