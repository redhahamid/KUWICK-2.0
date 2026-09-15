-- A CLINIC THAT CHOSE TO PAY BELOW THE ACT, AND SAID SO.
--
-- The Employment Act's rates were a hard floor here: a rate under them was
-- refused in Settings, and a clinic rate that came out under them on the day
-- was paid at the Act's figure while the run BLOCKED. That is not the
-- product's call to make. A clinic that decides to pay below the Act is taking
-- on a liability it is entitled to take on; Kuwick's job is to make sure
-- nobody does it by accident, and that the choice carries a name and a date --
-- not to overrule it.
--
-- So a below-Act figure saves now, and these four columns record the choice.
-- Nothing here excuses the figure: the run raises a warning naming everybody
-- the First Schedule reaches who is paid under it, the rule set wears a
-- permanent mark in Settings, and the payslip prints both rates.
--
-- below_act_terms is a fingerprint of EXACTLY the figures acknowledged, so
-- lowering a rate further cannot ride in on consent given for something else.
-- All four are NULL together on a rule set at or above the Act, which is every
-- rule set that exists today.
ALTER TABLE "payroll_policies"
  ADD COLUMN "below_act_terms" TEXT,
  ADD COLUMN "below_act_reason" TEXT,
  ADD COLUMN "below_act_acknowledged_at" TIMESTAMP(3),
  ADD COLUMN "below_act_acknowledged_by_staff_id" TEXT;

ALTER TABLE "payroll_policies"
  ADD CONSTRAINT "payroll_policies_below_act_acknowledged_by_staff_id_fkey"
  FOREIGN KEY ("below_act_acknowledged_by_staff_id") REFERENCES "staff"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
