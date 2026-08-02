-- G3b closure (D-064) — document authorisation semantics.
--
-- `signed_at` proved only that SOMEBODY signed something off: the route it
-- was written by accepted the signer from the request body and enforced no
-- role at all. Presenting every such row as "Signed" claims a doctor's
-- authorisation that the data cannot support. This migration adds the two
-- things needed to tell the truth instead:
--
--   1. whether a document required clinical authorisation in the first place
--      (snapshotted at creation, so later template edits cannot rewrite it)
--   2. what kind of sign-off it actually carries, with frozen actor identity
--
-- Nothing historical is rewritten. Existing signed rows are labelled
-- LEGACY_SIGN_OFF — which is exactly what is known about them — and no
-- doctor identity is invented for any of them.

CREATE TYPE "DocumentAuthorisationKind" AS ENUM ('CLINICAL', 'ADMINISTRATIVE', 'LEGACY_SIGN_OFF');

-- ---------------------------------------------------------------------------
-- Templates: is a document made from this template clinical?
--
-- DEFAULT TRUE is deliberate and fail-closed. An unclassified template is
-- treated as clinical until a clinic explicitly says otherwise; the opposite
-- default would let front desk authorise a referral the day it is created.
-- Classifying by template NAME was considered and rejected — the closure
-- forbids inferring clinical purpose from free text, and "Time Slip" is a
-- name a clinic chose, not a guarantee.
-- ---------------------------------------------------------------------------
ALTER TABLE "custom_document_templates" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "custom_document_templates"
  ADD COLUMN "requires_clinical_authorisation" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "custom_document_templates" FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------
ALTER TABLE "documents" NO FORCE ROW LEVEL SECURITY;

ALTER TABLE "documents"
  ADD COLUMN "requires_clinical_authorisation" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "authorisation_kind" "DocumentAuthorisationKind",
  ADD COLUMN "authorised_by_name_snapshot" TEXT,
  ADD COLUMN "authorised_by_role_snapshot" TEXT,
  ADD COLUMN "authorised_by_designation_snapshot" TEXT;

-- Every existing document keeps requires_clinical_authorisation = true, the
-- column default. That is correct for MC/REFERRAL/MEMO/QUARANTINE and
-- fail-closed for CUSTOM: a clinic can mark a CUSTOM template administrative
-- going forward, but we cannot retroactively prove an old one was.

-- Rows that were signed under the old route carry an operational sign-off of
-- unknown authority. Say so.
UPDATE "documents"
   SET "authorisation_kind" = 'LEGACY_SIGN_OFF'
 WHERE "signed_at" IS NOT NULL;

ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Fail loudly rather than ship a wrong clinical claim (D-048).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  bad_kind         INT;
  fabricated       INT;
  unsigned_but_set INT;
BEGIN
  -- No new-style authorisation may exist yet; nothing has run the route.
  SELECT count(*) INTO bad_kind
    FROM "documents"
   WHERE "authorisation_kind" IN ('CLINICAL', 'ADMINISTRATIVE');
  IF bad_kind > 0 THEN
    RAISE EXCEPTION 'Backfill produced % document(s) claiming CLINICAL/ADMINISTRATIVE authorisation. No historical row can support that claim.', bad_kind;
  END IF;

  -- No authoriser identity may have been invented for a historical row.
  SELECT count(*) INTO fabricated
    FROM "documents"
   WHERE "authorised_by_name_snapshot" IS NOT NULL
      OR "authorised_by_role_snapshot" IS NOT NULL
      OR "authorised_by_designation_snapshot" IS NOT NULL;
  IF fabricated > 0 THEN
    RAISE EXCEPTION 'Backfill fabricated authoriser identity on % document(s).', fabricated;
  END IF;

  -- An unsigned document must not come out of this looking authorised.
  SELECT count(*) INTO unsigned_but_set
    FROM "documents"
   WHERE "signed_at" IS NULL AND "authorisation_kind" IS NOT NULL;
  IF unsigned_but_set > 0 THEN
    RAISE EXCEPTION '% unsigned document(s) were given an authorisation kind.', unsigned_but_set;
  END IF;
END $$;

CREATE INDEX "documents_tenant_authorisation_idx"
  ON "documents" ("tenant_id", "requires_clinical_authorisation", "authorisation_kind");
