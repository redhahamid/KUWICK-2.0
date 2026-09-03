-- STAGE 3 — WHO THE OVERTIME PROVISIONS ACTUALLY REACH
--
-- Since the Employment (Amendment) Act 2022 came into force on 1 January 2023
-- the Act applies to all employees, but not every section does. The First
-- Schedule limits the hours-and-overtime provisions — s.60(3) rest-day pay,
-- s.60A overtime, s.60D(3) public-holiday pay — to employees whose WAGES DO NOT
-- EXCEED RM4,000 A MONTH.
--
-- Kuwick priced every employee's extra hours as though the Act reached them.
-- For anyone above the threshold that invents a statutory entitlement they do
-- not have, and it hides the distinction that matters when a dispute arises:
--
--   STATUTORY   the Act requires it, at its own rates, as a floor
--   CONTRACTUAL the Act does not reach them; the employer undertook to pay
--   NONE        the Act does not reach them and nobody undertook anything
--
-- This column records the employer's undertaking for the second and third
-- cases. NULL means nobody has said, and nothing is paid — surfaced as an
-- exception rather than resolved by assuming either answer. It is IGNORED for
-- an employee within the limit, where the Act's rates apply regardless of what
-- any contract says, because s.60I(2) makes them a floor.
--
-- NOTHING HERE ESTABLISHES A STATUTORY RULE. The threshold, its effective date
-- and the scope test live in src/statutory/employment-act.ts.

CREATE TYPE "OvertimeContractPolicy" AS ENUM ('PAY_AT_STATUTORY_RATES', 'NOT_PAID');

ALTER TABLE "employee_profiles"
  ADD COLUMN "overtime_contract_policy" "OvertimeContractPolicy";

COMMENT ON COLUMN "employee_profiles"."overtime_contract_policy" IS
  'What the employer undertook for extra hours above the First Schedule RM4,000 limit. NULL pays nothing and raises an exception.';
