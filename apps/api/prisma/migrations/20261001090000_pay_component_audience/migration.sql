-- WHO A PAYROLL ITEM IS FOR.
--
-- An item with a column of its own on the payroll grid gave that column to
-- every employee, so a director's fee or a locum session sat as an empty box
-- on a nurse's row every month. The item now says who it is for: everyone,
-- or the employees named on it. The grid gives the column to those people
-- alone, the items drawer offers it to them alone, a line keyed for anybody
-- else is refused, and carry forward copies it for them alone.
--
-- Audience, not statutory treatment: it changes in place without a date or a
-- reason, and a new treatment version carries it forward. Every existing
-- item stays "everyone", so no grid changes until somebody decides.
CREATE TYPE "PayComponentAudience" AS ENUM ('EVERYONE', 'SELECTED');

ALTER TABLE "pay_components"
  ADD COLUMN "applies_to" "PayComponentAudience" NOT NULL DEFAULT 'EVERYONE',
  ADD COLUMN "applies_to_staff_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];
