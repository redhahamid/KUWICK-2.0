-- A PUBLIC HOLIDAY CAN BE MARKED FESTIVE, AND A RULE SET CAN PRICE IT APART.
--
-- The holiday calendar held a date and a name, so the payroll engine priced
-- Hari Raya exactly like any other public holiday, and the clinic that pays
-- more for a festive day had no way to say so. Each holiday now carries a
-- kind: ORDINARY, which every existing row is, or FESTIVE. A rule set may
-- hold its own multiplier for the hours beyond normal hours on a festive
-- day, and its own RM per festive shift in clinic-rate mode. Blank means the
-- public holiday figure, so nothing moves until somebody marks a day and
-- sets a figure. The day itself stays the Act's two days' wages.
CREATE TYPE "PublicHolidayKind" AS ENUM ('ORDINARY', 'FESTIVE');

ALTER TABLE "public_holidays"
  ADD COLUMN "kind" "PublicHolidayKind" NOT NULL DEFAULT 'ORDINARY';

ALTER TABLE "payroll_policies"
  ADD COLUMN "clinic_festive_holiday_shift" DECIMAL(12,2),
  ADD COLUMN "festive_holiday_multiplier" DECIMAL(4,2);
