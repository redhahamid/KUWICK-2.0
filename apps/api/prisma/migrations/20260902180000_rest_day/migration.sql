-- STAGE 3 — THE DESIGNATED REST DAY
--
-- Payroll pooled every approved overtime minute in the month and paid the lot
-- at 1.5x. The Employment Act prices three different things, and two of them
-- are not priced in hours at all:
--
--   s.60A(3)(a)  a normal working day — hours beyond normal hours at >= 1.5x
--   s.60(3)      a REST DAY — half a day's wages at the ordinary rate for up to
--                half the normal hours, a whole day beyond that, and then >= 2x
--                hourly for anything past normal hours
--   s.60D(3)     a PAID PUBLIC HOLIDAY — TWO days' wages "regardless that the
--                period of work done on that day is less than the normal hours
--                of work", and then >= 3x hourly beyond normal hours
--
-- So an employee who came in for two hours on a public holiday was paid three
-- hours' worth where the Act owes them two days. Every such error was an
-- UNDERPAYMENT, which is the employer's liability to settle.
--
-- Public holidays were already recorded (public_holidays). The rest day was
-- not, and it CANNOT BE INFERRED: s.59 makes it the employer's to designate and
-- to tell the employee, so it is neither the day the clinic happens to be shut
-- nor a default of Sunday. NULL, therefore, with no backfill — and overtime for
-- an employee with none designated raises a blocking exception rather than
-- being priced as though every day were an ordinary working day.
--
-- NOTHING HERE ESTABLISHES A STATUTORY RULE. The multipliers and the day-rate
-- entitlements live in src/statutory/employment-act.ts, transcribed from the
-- sections themselves.

ALTER TABLE "employee_profiles" ADD COLUMN "rest_day_of_week" INTEGER;

ALTER TABLE "employee_profiles"
  ADD CONSTRAINT "employee_profiles_rest_day_of_week_check"
  CHECK ("rest_day_of_week" IS NULL OR ("rest_day_of_week" BETWEEN 0 AND 6));

COMMENT ON COLUMN "employee_profiles"."rest_day_of_week" IS
  'Employment Act s.59 rest day, 0 Sunday to 6 Saturday. NULL blocks overtime rather than pricing a rest day as an ordinary day.';
