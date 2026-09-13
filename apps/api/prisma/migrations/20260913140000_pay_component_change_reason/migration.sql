-- PAY COMPONENTS: WHY, AND WHO DECIDED.
--
-- `pay_components` already carried the statutory treatment of each kind of
-- money, effective-dated, with an independent flag per scheme. Two things it
-- could not say:
--
--   1. WHY a version exists. The reason reached the audit log as free text and
--      never the row, so the screen showing "EPF ✗ on allowances" could not
--      show why — and a flag nobody can explain is a flag nobody can defend to
--      KWSP.
--
--   2. WHO decided. Every seeded row says "Seeded to reproduce the existing
--      engine behaviour. Not verified against any authority." That is honest
--      about Kuwick's starting guess. It becomes a LIE the moment a clinic
--      sets its own policy on the same row: the clinic's decision is a
--      different kind of fact from Kuwick's guess, and a payslip's provenance
--      must not confuse the two.
--
-- Both are columns rather than a separate table because they describe THIS
-- version, and a version is already a row: the table is append-per-change, so
-- the history is the rows themselves.
--
-- No backfill. Every existing row is a seed or a pre-existing clinic edit, and
-- neither can be given a reason after the fact without inventing one. They stay
-- NULL, which reads as "no reason recorded" — true.

ALTER TABLE "pay_components"
  ADD COLUMN "clinic_override" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "change_reason"   TEXT;

COMMENT ON COLUMN "pay_components"."clinic_override" IS
  'This version''s statutory treatment was set by the clinic, not by the Kuwick seed.';
COMMENT ON COLUMN "pay_components"."change_reason" IS
  'Why this version exists, in the words of whoever made it. Required for a clinic treatment change.';
