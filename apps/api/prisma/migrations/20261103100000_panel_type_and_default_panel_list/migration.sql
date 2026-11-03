-- WHAT KIND OF BODY A PANEL IS (N-1).
--
-- A clinic owner already distinguishes a TPA administering someone else's
-- scheme from an insurer carrying its own risk, from a company it bills
-- directly, from a statutory body. Nothing in Kuwick could record it, so the
-- distinction lived in staff memory and the configuration screen had to ask
-- every panel every question.
--
-- IT DRIVES NO ARITHMETIC. No fee, term or bill-split path reads this column.
-- A classification that quietly moved money would be a second source of truth
-- beside `panel_fee_terms`, which is exactly what D-112 was spent removing.
--
-- NULLABLE WITH NO DEFAULT, and no backfill. Every existing panel reads as
-- unclassified, which the configuration screen reports and an owner answers.
-- Guessing a type from a panel's name would put invented facts in front of
-- somebody who would reasonably trust them.
CREATE TYPE "PanelType" AS ENUM ('TPA', 'INSURER', 'CORPORATE', 'GOVERNMENT', 'OTHER');

ALTER TABLE "panel_clinics" ADD COLUMN "panel_type" "PanelType";

-- The same classification on the platform's default list, so a clinic
-- provisioned tomorrow starts with its panels already sorted.
ALTER TABLE "default_panel_clinics" ADD COLUMN "panel_type" "PanelType";
