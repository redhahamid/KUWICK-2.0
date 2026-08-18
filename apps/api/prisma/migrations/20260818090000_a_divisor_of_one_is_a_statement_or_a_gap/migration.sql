-- A DIVISOR OF ONE IS EITHER A STATEMENT OR A GAP, AND THE COLUMN CANNOT TELL
-- YOU WHICH.
--
-- The pricing audit (docs/seed-review/medicine-pricing-divisors.csv) found 149
-- of 242 medicines with no divisor at all, 128 of them naming a container and
-- no count — BOX, BOTTLE, AMP, TUBE. Those need a person to state a fact the
-- spreadsheet never carried, and for many of them the fact IS "one": the bottle
-- is handed over whole.
--
-- Writing 1 into `quantity_per_stock_unit` records the number and loses the
-- statement. The next person cannot tell a bottle somebody looked at from a
-- strip nobody has, and the NEEDS ATTENTION worklist — the whole point of the
-- audit — would empty itself the moment anybody batch-filled the blanks.
--
-- So the statement is stored, with an author and a moment, the same shape the
-- allergy migration used for a MIGRATED row. Three states, all distinguishable:
--
--   quantity_per_stock_unit IS NULL              → nobody has said. NEEDS ATTENTION.
--   = 1, dispensed_whole_at IS NULL              → a bare 1. STILL needs attention.
--   = 1, dispensed_whole_at IS NOT NULL          → somebody said so, on a date.
--
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "items"
  ADD COLUMN "dispensed_whole_at" TIMESTAMP(3),
  ADD COLUMN "dispensed_whole_by_staff_id" TEXT;

-- The pair is held together by the database, not by the form. An edit that
-- moves the divisor to 30 while leaving the marker standing would leave the
-- clinic with a row that says "handed over whole" and bills in thirtieths;
-- the API clears the marker on any divisor change, and this refuses the row if
-- it ever stops doing so.
ALTER TABLE "items"
  ADD CONSTRAINT "items_dispensed_whole_means_one"
  CHECK ("dispensed_whole_at" IS NULL OR "quantity_per_stock_unit" = 1);

-- ─────────────────────────────────────────────────────────────────────────────
-- THE SHELF IS READ IN TWO LANGUAGES.
--
-- Kuwick 1.0 prints a stock balance as "99 Strip / Papan". The staff counting
-- the shelf read the Malay half, and the platform's English name is the
-- identifier the unique constraint is on — so the translation is a column
-- beside it rather than a rename. NULL where nobody has translated it: a unit a
-- clinic adds itself renders its English name alone, which is honest, where a
-- machine guess at a Malay word for it would not be.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "stock_units" ADD COLUMN "name_ms" TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- THE CATEGORY LIST BECOMES A LIST.
--
-- `items.category` is a plain string and STAYS the truth on the row — the
-- import writes it, the CSV upload writes it, every reader reads it. This table
-- is the registry of the names, which is what lets a clinic add a section
-- before anything is filed in it, rename one in a single place, and be REFUSED
-- a delete while items still carry it.
--
-- Backfilled from the strings actually in use, so the list starts out matching
-- the shelf rather than empty beside a catalogue full of categories.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "item_categories" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "item_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "item_categories_tenant_id_name_key" ON "item_categories"("tenant_id", "name");
CREATE INDEX "item_categories_tenant_id_idx" ON "item_categories"("tenant_id");

ALTER TABLE "item_categories" ADD CONSTRAINT "item_categories_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-Level Security (see force_rls_core_foundation migration for why both
-- ENABLE and FORCE are required).
ALTER TABLE "item_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "item_categories" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "item_categories"
  USING (tenant_id = current_setting('app.tenant_id', true));

-- FORCE applies to the table owner too and no migration sets app.tenant_id, so
-- the policy is lifted for the length of the copy and put straight back. The
-- rows carry each item's own tenant_id, so what the policy would have enforced
-- is enforced by the SELECT itself.
ALTER TABLE "item_categories" NO FORCE ROW LEVEL SECURITY;

INSERT INTO "item_categories" ("id", "tenant_id", "name", "sort_order", "created_at", "updated_at")
SELECT gen_random_uuid()::text, i."tenant_id", btrim(i."category"), 0, now(), now()
FROM "items" i
WHERE i."category" IS NOT NULL AND btrim(i."category") <> ''
GROUP BY i."tenant_id", btrim(i."category");

ALTER TABLE "item_categories" FORCE ROW LEVEL SECURITY;
