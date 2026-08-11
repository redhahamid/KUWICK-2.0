-- G4c1 (D-068) — safe visit-number allocation.
--
-- `VisitService.nextVisitNumber()` was `count(*) + 1`. That derives the next
-- number from how many rows EXIST rather than which numbers have been USED, so:
--
--   * deleting any visit makes the count fall behind the highest number in use,
--     and the next create collides with a live row on
--     `visits_tenant_id_visit_number_key` — surfacing as a raw 500;
--   * two concurrent registrations read the same count and produce the same
--     number, which the unique index then rejects for one of them.
--
-- Both were reproduced. This migration adds a per-tenant counter that is
-- incremented atomically, so a number is never derived from a count and never
-- reissued because a visit was deleted.
--
-- SCOPE. The counter is keyed by tenant because that is the scope the database
-- actually enforces: `visits_tenant_id_visit_number_key` is on
-- (tenant_id, visit_number). It is deliberately NOT keyed by clinic — a
-- clinic-scoped counter would immediately produce duplicate numbers within a
-- tenant. The visible format (`V-` + six zero-padded digits) is unchanged, and
-- no historical visit number is rewritten.

CREATE TABLE IF NOT EXISTS "visit_number_counters" (
  "tenant_id"  TEXT NOT NULL,
  -- The last number ISSUED. 0 means "nothing issued yet", so the first
  -- allocation returns 1 and formats as V-000001.
  "next_value" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "visit_number_counters_pkey" PRIMARY KEY ("tenant_id"),
  CONSTRAINT "visit_number_counters_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  -- A counter can only ever move forward.
  CONSTRAINT "visit_number_counters_next_value_check" CHECK ("next_value" >= 0)
);

-- ---------------------------------------------------------------------------
-- RLS must be lifted for the seeding step, or the backfill silently seeds
-- NOTHING.
--
-- `tenants` and `visits` are FORCE ROW LEVEL SECURITY with policies keyed on
-- `current_setting('app.tenant_id')`. A migration runs with that GUC unset, so
-- every SELECT against them returns zero rows — and FORCE means even the table
-- owner is subject. The first version of this migration read as correct and
-- seeded no counters at all; it was caught because a tenant with 250 visits
-- ended up with no counter row. NO FORCE / FORCE is the same pattern the
-- G3b-closure migration uses when it has to touch guarded tables.
-- ---------------------------------------------------------------------------
ALTER TABLE "tenants" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "visits" NO FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Fail closed on an ambiguous numbering state.
--
-- A well-formed number that will not fit in INTEGER cannot be seeded safely,
-- and silently ignoring it would let the counter reissue a number that is
-- already in use. Refuse to migrate instead of guessing.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  oversized INTEGER;
BEGIN
  SELECT count(*) INTO oversized
  FROM "visits"
  WHERE "visit_number" ~ '^V-[0-9]{10,}$';

  IF oversized > 0 THEN
    RAISE EXCEPTION
      'Refusing to seed visit-number counters: % visit number(s) exceed the INTEGER range. Resolve these rows first.',
      oversized;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Backfill from the highest VALID number per tenant — never from a row count.
--
-- Malformed and legacy values (anything not `V-<digits>`) are ignored for
-- seeding and are NOT rewritten: they stay exactly as the clinic recorded
-- them. A tenant whose numbers are all malformed seeds at 0 and starts issuing
-- V-000001; the unique index still protects it, and the application's
-- repair-and-retry path advances the counter past any collision.
--
-- Repeat-safe: ON CONFLICT DO NOTHING, and re-running cannot lower a counter.
-- ---------------------------------------------------------------------------
INSERT INTO "visit_number_counters" ("tenant_id", "next_value")
SELECT
  t."id",
  COALESCE(
    MAX(
      CASE
        WHEN v."visit_number" ~ '^V-[0-9]{1,9}$'
        THEN substring(v."visit_number" FROM 3)::INTEGER
      END
    ),
    0
  )
FROM "tenants" t
LEFT JOIN "visits" v ON v."tenant_id" = t."id"
GROUP BY t."id"
ON CONFLICT ("tenant_id") DO NOTHING;

-- Re-running must never lower a counter that the application has already
-- advanced, and must repair any tenant seeded before this fix.
UPDATE "visit_number_counters" c
   SET "next_value" = GREATEST(c."next_value", s."highest"),
       "updated_at" = now()
  FROM (
    SELECT v."tenant_id",
           COALESCE(MAX(substring(v."visit_number" FROM 3)::INTEGER), 0) AS "highest"
      FROM "visits" v
     WHERE v."visit_number" ~ '^V-[0-9]{1,9}$'
     GROUP BY v."tenant_id"
  ) s
 WHERE s."tenant_id" = c."tenant_id"
   AND c."next_value" < s."highest";

ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
ALTER TABLE "visits" FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- RLS last, so the backfill above is not filtered by the policy it installs.
-- Same tenant_isolation shape as `visits` itself: keyed on app.tenant_id, and
-- deliberately NOT honouring app.bypass_tenant_scope, because `visits` does
-- not either — the counter must not be readable in a context where the visits
-- it numbers are invisible.
-- ---------------------------------------------------------------------------
ALTER TABLE "visit_number_counters" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visit_number_counters" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "visit_number_counters";
CREATE POLICY tenant_isolation ON "visit_number_counters"
  USING (tenant_id = current_setting('app.tenant_id', true));
