-- THE CLINIC'S OWN OVERTIME MULTIPLIERS.
--
-- A rule set could price extra hours two ways: the Employment Act's fixed
-- 1.5x / 2x / 3x, or fixed ringgit amounts. Neither expresses "we pay overtime
-- at 2x", which is what a clinic paying ABOVE the Act does, so a clinic that
-- pays more than the law requires had to choose between a rate it had outgrown
-- and a flat amount that stops tracking the salary.
--
-- NULL is the Act's multiplier, which is what every existing rule set gets and
-- what every existing run already used -- so this migration changes no figure
-- anywhere. A value below the Act's is refused before it can be stored:
-- ss.60A(3)(a), 60(3)(c) and 60D(3)(aa) are minimums.
--
-- Decimal(4,2) holds 0.01 through 99.99; the application caps the range far
-- tighter than the column does.
ALTER TABLE "payroll_policies"
  ADD COLUMN "overtime_multiplier" DECIMAL(4,2),
  ADD COLUMN "rest_day_multiplier" DECIMAL(4,2),
  ADD COLUMN "public_holiday_multiplier" DECIMAL(4,2);
