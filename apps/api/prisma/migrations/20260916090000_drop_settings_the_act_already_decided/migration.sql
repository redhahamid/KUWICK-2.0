-- TEN SETTINGS THAT SAVED AND WERE NEVER OBEYED.
--
-- The settings audit found fourteen. Three were wired up in earlier pieces; the
-- owner has now decided each of the rest one at a time, and these ten go.
--
-- FOUR BECAUSE THE EMPLOYMENT ACT HAD ALREADY DECIDED. A part month is monthly
-- wages over the ACTUAL days in it (ss.18A and 60I(1)(c)); a day of unpaid
-- leave is the same arithmetic, expressly named in s.18A; the ordinary-rate
-- divisor is fixed at 26 by s.60I(1A) and may only be bettered. Offering a
-- clinic a choice the law does not give it is worse than offering none: it
-- invites somebody to set 26 for a part month and underpay every joiner in a
-- 31-day month.
--   salary_proration_basis, salary_proration_days, unpaid_leave_basis,
--   unpaid_leave_days, overtime_basis
--
-- TWO BECAUSE THE FEATURE THEY CONFIGURE DOES NOT EXIST. Paid leave is not
-- valued separately anywhere -- salary covers it -- and the owner does not want
-- it valued separately.
--   leave_pay_basis, leave_pay_days
--
-- ONE BECAUSE IT WAS A SWITCH WITH ONE POSITION. Only approved extra time has
-- ever reached payroll, whatever overtime_requires_approval said. Honouring the
-- off position would have given a clinic a way to pay extra time that no second
-- person agreed to, so the switch goes and the rule is stated on the screen.
--   overtime_requires_approval
--
-- TWO BECAUSE THEY WOULD DOUBLE-COUNT. A flat break deducted from any long
-- shift, computing a payable-minutes figure nothing read. This clinic's staff
-- clock out for their break and back in again, so the break is already out of
-- the worked minutes and deducting it again would take it twice.
--   unpaid_break_minutes, break_after_minutes
--
-- AND ONE FROZEN COPY. orp_unpaid_leave_days was written onto every run and
-- read by nothing: s.18A governs the divisor, so the column recorded what had
-- been applied when nothing had been. Historical payslip snapshots are JSON and
-- keep whatever they already hold; this only stops new runs carrying a figure
-- that priced nothing.
--
-- WHAT STAYS: termination_basis and termination_days. The final settlement is
-- the one question the Act leaves to the employer, the owner wants the feature,
-- and it is a feature to build rather than a switch to flip.

ALTER TABLE "payroll_policies"
  DROP COLUMN "salary_proration_basis",
  DROP COLUMN "salary_proration_days",
  DROP COLUMN "overtime_basis",
  DROP COLUMN "unpaid_leave_basis",
  DROP COLUMN "unpaid_leave_days",
  DROP COLUMN "leave_pay_basis",
  DROP COLUMN "leave_pay_days";

ALTER TABLE "attendance_policies"
  DROP COLUMN "overtime_requires_approval",
  DROP COLUMN "unpaid_break_minutes",
  DROP COLUMN "break_after_minutes";

ALTER TABLE "payroll_runs"
  DROP COLUMN "orp_unpaid_leave_days";
