-- HOW THE REMAINING MONTHS ARE ESTIMATED FOR MONTHLY TAX.
--
-- The MTD method is cumulative and forward-looking: this month's deduction
-- depends on what the employee is expected to earn for the REST of the year --
-- the specification's Y2. LHDN describes it as "the estimated remuneration as
-- Y1" and leaves the estimate to the employer, so it is a clinic's choice and
-- not something the law settles.
--
-- `estimatedFutureNormalCents` has been an input to Kuwick's PCB engine since
-- it was written, and nothing ever supplied it -- so every clinic silently got
-- CURRENT_MONTH. This column is what supplies it, and it defaults to exactly
-- that, so no existing clinic's tax moves because the field appeared.
--
-- It matters most where pay swings. Reconciling one doctor's August 2026
-- payslip, the same month came out at RM3,930.20 projecting the current month's
-- normal remuneration and RM1,852.70 projecting basic salary alone -- a
-- difference of RM2,077 on one payslip.
CREATE TYPE "PcbProjectionBasis" AS ENUM ('CURRENT_MONTH', 'BASIC_ONLY', 'CONTRACTUAL_MONTHLY');

ALTER TABLE "payroll_policies"
  ADD COLUMN "pcb_projection_basis" "PcbProjectionBasis" NOT NULL DEFAULT 'CURRENT_MONTH';
