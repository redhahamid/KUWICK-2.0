-- STAGE 3 — THE MTD TAX PROFILE
--
-- HASiL's Computerised Calculation needs facts about the employee that Kuwick
-- did not hold. `residential_status` existed as free text and nothing ever read
-- or wrote it; marital status was free text and could not distinguish the three
-- categories the specification uses; children and disability were absent.
--
-- Two of these BLOCK rather than default, because a default would be a guess
-- that changes the answer by a large amount:
--
--   * tax_residence — MTD for a non-resident is a flat 30% of remuneration with
--     no deductions whatever. Assuming RESIDENT for a non-resident under-
--     deducts by most of the liability.
--   * pcb_category — decides whether the spouse deduction applies and whether
--     children may be counted at all.
--
-- Three DEFAULT, and the direction of the default is deliberate: no children
-- and no disability deduct MORE tax, not less. An employer withholds on the
-- facts it holds and the employee recovers any excess on assessment; the
-- opposite default would under-deduct on a guess, which is the employer's
-- problem rather than the employee's.
--
-- NOTHING HERE ESTABLISHES A STATUTORY RULE. The formula and Table 1 live in
-- src/statutory/pcb-2026.ts, transcribed from the specification itself.

CREATE TYPE "TaxResidence" AS ENUM ('RESIDENT', 'NON_RESIDENT');
CREATE TYPE "PcbCategory" AS ENUM ('CATEGORY_1', 'CATEGORY_2', 'CATEGORY_3');

ALTER TABLE "employee_profiles"
  ADD COLUMN "tax_residence" "TaxResidence",
  ADD COLUMN "pcb_category" "PcbCategory",
  ADD COLUMN "qualifying_children" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "disabled_self" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "disabled_spouse" BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN "employee_profiles"."tax_residence" IS
  'MTD residence. NULL blocks the PCB calculation rather than assuming RESIDENT.';
COMMENT ON COLUMN "employee_profiles"."pcb_category" IS
  'HASiL MTD category 1, 2 or 3. NULL blocks the PCB calculation.';
