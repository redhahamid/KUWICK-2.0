-- OWN COLUMNS ON THE PAYROLL GRID, AND LAST MONTH'S AMOUNT TO START FROM.
--
-- A clinic's real habit is a spreadsheet: one column per kind of pay, last
-- month's figures already there, and only the numbers change. Two switches on
-- a payroll item say which items get that treatment. Both are LAYOUT, not
-- statutory treatment, so they change in place and never make a dated
-- version of the item.
--
--   grid_column   the item has its own editable column on the payroll grid
--   carry_forward a new month starts with last month's hand-keyed amount
--
-- A copied row remembers the row it came from until somebody edits or clears
-- it, which is what the grid and the review step show as "carried from".
ALTER TABLE "pay_components"
  ADD COLUMN "grid_column" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "carry_forward" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "payroll_input_entries"
  ADD COLUMN "carried_from_id" TEXT;
