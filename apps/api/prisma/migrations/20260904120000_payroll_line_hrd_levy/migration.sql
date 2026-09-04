-- P1 — THE HRD LEVY REACHES THE RUN.
--
-- The levy engine (src/statutory/hrd-levy.ts, OFFICIAL_SOURCE_VERIFIED from
-- HRD Corp's own Levy Calculation Guideline) has existed since Stage 3 and was
-- wired into nothing: a registered employer's payroll showed an employer cost
-- that was short by 1% of leviable wages, every month, and the omission looked
-- exactly like a clinic that was not registered.
--
-- The levy is computed per employee at calculation — on the guideline's own
-- base, (basic - unpaid leave) + FIXED allowances, read off the components'
-- effective-dated hrd_liable flags — and lands in employer cost. NULL means
-- "could not be worked out" (employer registration unrecorded, or the
-- citizenship-bearing EPF membership missing), and is reported, never zero.
--
-- Nothing is backfilled: an approved run's employer cost is what was approved.

ALTER TABLE "payroll_lines" ADD COLUMN "hrd_levy" DECIMAL(12,2);
