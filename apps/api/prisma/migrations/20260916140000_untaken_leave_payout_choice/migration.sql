-- WHETHER UNTAKEN ANNUAL LEAVE IS PAID OUT WHEN SOMEBODY LEAVES.
--
-- s.60E(3) of the Employment Act: where EITHER party terminates the contract of
-- service before the employee has taken the paid annual leave they are entitled
-- to, the employer pays the ordinary rate of pay for each untaken day. Either
-- party -- so a resignation is covered exactly as a dismissal. The account
-- holder confirmed that reading against the Act's own text, which is why the
-- default here is TRUE and not the clinic's current practice.
--
-- FALSE IS ALLOWED AND IS NEVER SILENT. An employer who decides not to pay it
-- is choosing not to meet a statutory obligation; that is their decision and
-- their exposure. What Kuwick owes in return is that nobody does it by
-- accident: the three columns record who chose, when and why, Settings marks
-- the policy permanently, and every payroll run names the leaver and the amount
-- that was not paid.
--
-- The same shape as a below-Act overtime multiplier, deliberately. One pattern
-- for "the clinic may go under the Act, on the record" is easier to trust than
-- two.
ALTER TABLE "leave_policies"
  ADD COLUMN "pay_untaken_leave_on_exit" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "not_paying_reason" TEXT,
  ADD COLUMN "not_paying_acknowledged_at" TIMESTAMP(3),
  ADD COLUMN "not_paying_acknowledged_by_staff_id" TEXT;

ALTER TABLE "leave_policies"
  ADD CONSTRAINT "leave_policies_not_paying_acknowledged_by_staff_id_fkey"
  FOREIGN KEY ("not_paying_acknowledged_by_staff_id") REFERENCES "staff"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
