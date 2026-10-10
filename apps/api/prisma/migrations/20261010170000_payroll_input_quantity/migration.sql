-- An imported unpaid-leave line's days, priced by the run (UAT, 10 October 2026).
-- Nullable, no default: every existing line is an amount, as before.
ALTER TABLE "payroll_input_entries" ADD COLUMN "quantity" DECIMAL(6,2);
