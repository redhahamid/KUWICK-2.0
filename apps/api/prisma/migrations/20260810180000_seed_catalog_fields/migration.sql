-- KW2-Q3 — the fields the clinic's own diagnosis and inventory exports need.
--
-- The principle throughout: PRESERVE, then present. Anything cleaned up for
-- display keeps the original beside it, because a medicine name nobody
-- recognises is worse than an untidy one, and a clinic that cannot find
-- "##***T. YASMIN 3MG" by its real name will stop trusting the search.

-- ---------------------------------------------------------------------------
-- 1. Diagnosis: how the clinic actually says it.
--
-- Nobody types "Acute upper respiratory infection" mid-consultation. They type
-- "urti". The shortform is searched alongside the code and the full name.
-- ---------------------------------------------------------------------------
ALTER TABLE "diagnosis_catalog" ADD COLUMN "shortform" TEXT;

-- Idempotent re-seeding needs a key. The name is already unique per tenant;
-- the CODE is what the seed file is keyed on, and two rows sharing one code
-- would make "which J06.9 did the visit mean?" unanswerable.
--
-- Partial, because a custom diagnosis added through Settings legitimately has
-- no ICD-10 code and any number of those may exist.
CREATE UNIQUE INDEX "diagnosis_catalog_tenant_icd10_key"
  ON "diagnosis_catalog" ("tenant_id", "icd10_code")
  WHERE "icd10_code" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Items: provenance, packaging, and how the form should behave.
-- ---------------------------------------------------------------------------
CREATE TYPE "item_dosing_type" AS ENUM ('WEIGHT_BASED', 'AGE_BAND', 'ADULT_DEFAULT');

ALTER TABLE "items" ADD COLUMN "external_ref" TEXT;
ALTER TABLE "items" ADD COLUMN "source_name" TEXT;
ALTER TABLE "items" ADD COLUMN "group_tag" TEXT;
ALTER TABLE "items" ADD COLUMN "cash_only" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "items" ADD COLUMN "pack_description" TEXT;
ALTER TABLE "items" ADD COLUMN "units_per_pack" INTEGER;
ALTER TABLE "items" ADD COLUMN "earliest_expiry" DATE;
ALTER TABLE "items" ADD COLUMN "dosing_type" "item_dosing_type" NOT NULL DEFAULT 'ADULT_DEFAULT';

-- The import's idempotency key. Partial for the same reason as above: items
-- created by hand in Settings have no source row, and there will be many.
CREATE UNIQUE INDEX "items_tenant_external_ref_key"
  ON "items" ("tenant_id", "external_ref")
  WHERE "external_ref" IS NOT NULL;

-- The medication search filters by group and orders by name; the group is
-- also offered as a filter chip.
CREATE INDEX "items_tenant_group_idx" ON "items" ("tenant_id", "group_tag");

-- A units-per-pack of zero would make a pack-count division blow up, and a
-- negative one is meaningless. NULL stays allowed: it means the source did not
-- state a count, which is different from stating none.
ALTER TABLE "items" ADD CONSTRAINT "items_units_per_pack_positive"
  CHECK ("units_per_pack" IS NULL OR "units_per_pack" > 0);
