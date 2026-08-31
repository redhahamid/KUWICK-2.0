-- D-041 SUPERSEDED ON THE FEE DIRECTION. Owner decision, 2026-08-31.
--
-- D-041 recorded `receivable = claimed + fee`. The clinic's own claim workbook
-- and its bank credits say otherwise, and the owner has accepted that evidence
-- as the source of truth for the current panel setup:
--
--   * all 29 workbook sheets compute CLAIM TO RECEIVE = CLAIMED - FEE
--   * 2,615 of 2,640 paid fee-bearing claims banked at exactly claimed - fee
--   * 2 banked at the claimed amount, both investigated
--   * none banked at claimed + fee
--
-- This migration does four things:
--
--   1. replaces the two-value fee DIRECTION with a four-value fee TREATMENT,
--      so "no fee" and "nobody knows" are different states rather than both
--      being NULL;
--   2. adds the effective-dated PanelFeeTerm history, so a future contract
--      change cannot alter historical receivables;
--   3. BACKFILLS every existing panel and claim off the old +fee behaviour;
--   4. writes an initial fee term per panel recording the evidence.
--
-- The backfill is deliberately conservative: a panel with a fee configured
-- becomes WITHHELD_FROM_CLAIM (the owner's default for existing panels), and a
-- panel with no fee configured becomes NO_FEE. Nothing is left UNCONFIGURED by
-- this migration; where the workbook evidence is genuinely insufficient for a
-- panel, that is recorded by the operator against that panel, not guessed here.

CREATE TYPE "PanelFeeTreatment" AS ENUM (
  'WITHHELD_FROM_CLAIM',
  'ADDED_TO_RECEIVABLE',
  'NO_FEE',
  'UNCONFIGURED'
);

ALTER TABLE "panel_clinics"
  ADD COLUMN "fee_treatment" "PanelFeeTreatment" NOT NULL DEFAULT 'UNCONFIGURED';
ALTER TABLE "claim_batch_lines"
  ADD COLUMN "fee_treatment" "PanelFeeTreatment" NOT NULL DEFAULT 'UNCONFIGURED';

-- --------------------------------------------------------------------------
-- 3a. PANELS. A configured, non-zero fee means the panel charges one, and the
--     owner's decision is that existing panels withhold it.
-- --------------------------------------------------------------------------
UPDATE "panel_clinics"
   SET "fee_treatment" = 'WITHHELD_FROM_CLAIM'
 WHERE "claim_fee_type" IS NOT NULL
   AND COALESCE("claim_fee_value", 0) > 0;

UPDATE "panel_clinics"
   SET "fee_treatment" = 'NO_FEE'
 WHERE "claim_fee_type" IS NULL
    OR COALESCE("claim_fee_value", 0) = 0;

-- Anything the old column had explicitly set is honoured over the default
-- above: an operator who had already chosen a direction meant it.
UPDATE "panel_clinics" SET "fee_treatment" = 'ADDED_TO_RECEIVABLE'
 WHERE "fee_direction" = 'ADDED';
UPDATE "panel_clinics" SET "fee_treatment" = 'WITHHELD_FROM_CLAIM'
 WHERE "fee_direction" = 'WITHHELD';

-- --------------------------------------------------------------------------
-- 3b. CLAIMS. A claim carrying no fee has nothing to get wrong; one carrying a
--     fee moves off the old +fee behaviour to what the evidence establishes.
--     Claims keep their own snapshot: this is the one moment it is rewritten,
--     and it is rewritten because the old value was wrong, not because a
--     contract changed.
-- --------------------------------------------------------------------------
UPDATE "claim_batch_lines" SET "fee_treatment" = 'NO_FEE'
 WHERE COALESCE("fee_amount", 0) = 0;

UPDATE "claim_batch_lines" l
   SET "fee_treatment" = p."fee_treatment"
  FROM "claim_batches" b, "panel_clinics" p
 WHERE l."claim_batch_id" = b."id"
   AND b."panel_clinic_id" = p."id"
   AND COALESCE(l."fee_amount", 0) > 0;

-- An explicit direction already stamped on a claim wins, same reasoning.
UPDATE "claim_batch_lines" SET "fee_treatment" = 'ADDED_TO_RECEIVABLE'
 WHERE "fee_direction" = 'ADDED' AND COALESCE("fee_amount", 0) > 0;
UPDATE "claim_batch_lines" SET "fee_treatment" = 'WITHHELD_FROM_CLAIM'
 WHERE "fee_direction" = 'WITHHELD' AND COALESCE("fee_amount", 0) > 0;

ALTER TABLE "panel_clinics" DROP COLUMN "fee_direction";
ALTER TABLE "claim_batch_lines" DROP COLUMN "fee_direction";
DROP TYPE "PanelFeeDirection";

-- --------------------------------------------------------------------------
-- 4. THE EFFECTIVE-DATED HISTORY.
-- --------------------------------------------------------------------------
CREATE TABLE "panel_fee_terms" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "panel_clinic_id" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "fee_treatment" "PanelFeeTreatment" NOT NULL,
    "fee_type" "PanelClaimFeeType",
    "fee_value" DECIMAL(10,2),
    "note" TEXT,
    "recorded_by_staff_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "panel_fee_terms_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "panel_fee_terms_tenant_panel_from_key"
  ON "panel_fee_terms"("tenant_id", "panel_clinic_id", "effective_from");
CREATE INDEX "panel_fee_terms_tenant_panel_from_idx"
  ON "panel_fee_terms"("tenant_id", "panel_clinic_id", "effective_from");

ALTER TABLE "panel_fee_terms"
  ADD CONSTRAINT "panel_fee_terms_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "panel_fee_terms_panel_fkey" FOREIGN KEY ("panel_clinic_id") REFERENCES "panel_clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "panel_fee_terms_recorded_by_fkey" FOREIGN KEY ("recorded_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The opening term for every existing panel. Dated 1970-01-01 deliberately:
-- this is not a term agreed on a date, it is the term that has been in force
-- for as long as the panel has existed, and back-dating it means no historical
-- claim falls before the history starts.
INSERT INTO "panel_fee_terms"
  ("id", "tenant_id", "panel_clinic_id", "effective_from", "fee_treatment", "fee_type", "fee_value", "note")
SELECT
  gen_random_uuid()::text,
  p."tenant_id",
  p."id",
  DATE '1970-01-01',
  p."fee_treatment",
  p."claim_fee_type",
  p."claim_fee_value",
  'Opening term, set by the D-041 supersession migration (2026-08-31). '
    || CASE p."fee_treatment"
         WHEN 'WITHHELD_FROM_CLAIM' THEN 'Panel charges a fee; owner decision of 2026-08-31 sets the default for existing panels to withheld, on the evidence of 2,615 of 2,640 paid claims banking at claimed minus fee.'
         WHEN 'NO_FEE' THEN 'No claim fee configured for this panel.'
         WHEN 'ADDED_TO_RECEIVABLE' THEN 'Direction had already been set explicitly to added and was honoured.'
         ELSE 'Could not be established.'
       END
FROM "panel_clinics" p;

ALTER TABLE "panel_fee_terms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "panel_fee_terms" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "panel_fee_terms"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kuwick_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "panel_fee_terms" TO kuwick_app;
  END IF;
END $$;
