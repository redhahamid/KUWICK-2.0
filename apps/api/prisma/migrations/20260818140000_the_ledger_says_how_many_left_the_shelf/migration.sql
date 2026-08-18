-- THE LEDGER HAS BEEN RECORDING THE WRONG NUMBER, AND HAS NO WAY TO SAY SO.
--
-- `stock_movements.quantity_delta` is counted in STOCK UNITS — strips, boxes,
-- bottles — because that is what `stock_levels.quantity_on_hand` counts and
-- what a person counting the shelf counts. Both dispensing paths have been
-- writing `-prescription.quantity` into it, and a prescription's quantity is
-- counted in DOSE UNITS: 30 tablets, not 3 strips.
--
-- The arithmetic is now `ceil(clinical ÷ divisor)`, the same conversion the
-- bill goes through (`dispense-pricing.ts`). That fixes the delta, and it
-- creates a question the row cannot answer: somebody reading "3 strips left
-- the shelf" needs to know it was for a 30-tablet course, or the ledger and
-- the prescription look like they disagree.
--
-- So the clinical figure is recorded beside the stock figure. Two numbers, one
-- row, and the conversion between them is legible without joining back to an
-- item whose divisor may have been corrected since.
--
-- NULLABLE, PERMANENTLY, AND NOT BACKFILLED. Every row written before today
-- carries a delta in dose units mislabelled as stock units. Guessing which is
-- which now — dividing historical deltas by today's divisor — would rewrite an
-- append-only ledger with arithmetic nobody performed at the counter. What the
-- shelf actually holds is a physical stock-take's answer, not a migration's.
-- NULL here means exactly "this row predates the conversion", which is true.

ALTER TABLE "stock_movements" ADD COLUMN "clinical_quantity" INTEGER;

COMMENT ON COLUMN "stock_movements"."clinical_quantity" IS
  'Dose units the prescription was written for (30 tablets), where quantity_delta is the stock units that left the shelf (3 strips). NULL on rows written before the conversion existed.';
