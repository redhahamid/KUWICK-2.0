-- ONE PLACE TO RECORD AN ALLERGY.
--
-- There were two. The header chip wrote a free-text array into
-- `patients.allergies` — no author, no timestamp, no history — while the alerts
-- popover beside it wrote an ALLERGY alert, attributed and append-only. For
-- do-not-prescribe information that is the wrong way round: the store a doctor
-- reaches for in two clicks mid-consult was the one that could not say who
-- recorded it or when.
--
-- The chip stays. Recording an allergy in two clicks is the behaviour that gets
-- allergies recorded at all, and taking it away to win a tidier data model
-- would cost more than the duplication did. Only its DESTINATION changes.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE ATTRIBUTION DECISION (owner, 2026-08-16)
--
-- `created_by_staff_id` is NOT NULL, and the values in `patients.allergies`
-- have no author: nobody knows who typed "NSAIDS" or when. The three honest
-- options were a system staff row that is visibly not a person, a nullable
-- author for migrated rows only, or not backfilling at all. The owner chose the
-- second, and the trade-off is stated rather than hidden:
--
--   * `created_by_staff_id` stops being unconditionally NOT NULL.
--   * A CHECK constraint permits the null ONLY when `origin = 'MIGRATED'`, so
--     every alert a PERSON records still has a real author or the database
--     refuses the row.
--   * Nothing in the API can set `origin = 'MIGRATED'` — it is not in any DTO
--     and the service does not accept it — so the exemption cannot spread.
--
-- The alternative rejected: putting a fake staff member in the `staff` table,
-- which the HR screens, the roster, the user list and every staff picker read.
-- A reader who did not know the history would see an author where there was
-- none, which is worse than an honest blank.
--
-- The TIMESTAMP is the migration's own, and the row says so. It records when
-- Kuwick learned this, which is the only date anybody actually knows —
-- backdating to the patient's registration would assert the allergy was
-- recorded then, and the free-text field could have been edited at any point.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "PatientAlertOrigin" AS ENUM ('HUMAN', 'MIGRATED');

ALTER TABLE "patient_alerts"
  ADD COLUMN "origin" "PatientAlertOrigin" NOT NULL DEFAULT 'HUMAN';

ALTER TABLE "patient_alerts"
  ALTER COLUMN "created_by_staff_id" DROP NOT NULL;

-- The guarantee, narrowed rather than dropped. A human-recorded alert without
-- an author is refused by PostgreSQL exactly as it was before.
ALTER TABLE "patient_alerts"
  ADD CONSTRAINT "patient_alerts_human_rows_are_attributed"
  CHECK ("origin" = 'MIGRATED' OR "created_by_staff_id" IS NOT NULL);

-- ─────────────────────────────────────────────────────────────────────────────
-- THE BACKFILL
--
-- `patient_alerts` is under FORCE ROW LEVEL SECURITY, and its INSERT policy
-- tests `current_setting('app.tenant_id')` — which no migration sets, and FORCE
-- applies to the table owner too. So the policy is lifted for the length of the
-- copy and put back immediately. The rows carry the patient's own tenant_id, so
-- what the policy would have enforced is enforced by the SELECT itself.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "patient_alerts" NO FORCE ROW LEVEL SECURITY;

-- Each recorded allergy becomes an ALLERGY alert. Skipped where an equivalent
-- active alert already exists, compared case- and whitespace-insensitively:
-- the same allergy legitimately lives in both stores today, and the point of
-- this migration is to end that, not to render it twice.
INSERT INTO "patient_alerts" (
  "id", "tenant_id", "patient_id", "type", "label", "note", "active",
  "created_by_staff_id", "created_at", "origin"
)
SELECT
  gen_random_uuid()::text,
  p."tenant_id",
  p."id",
  'ALLERGY',
  btrim(entry),
  'Carried over from the patient record when allergies moved to alerts. No author was recorded at the time.',
  true,
  NULL,
  now(),
  'MIGRATED'
FROM "patients" p
CROSS JOIN LATERAL jsonb_array_elements_text(p."allergies") AS entry
WHERE p."allergies" IS NOT NULL
  AND jsonb_typeof(p."allergies") = 'array'
  AND btrim(entry) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "patient_alerts" a
    WHERE a."patient_id" = p."id"
      AND a."type" = 'ALLERGY'
      AND a."active"
      AND lower(btrim(a."label")) = lower(btrim(entry))
  );

-- An EMPTY list is the confirmed negative, and the fact most easily lost here:
-- somebody asked, and the answer was none. Whitespace-only entries count as
-- empty — "  " is not an allergy anybody recorded.
INSERT INTO "patient_alerts" (
  "id", "tenant_id", "patient_id", "type", "label", "note", "active",
  "created_by_staff_id", "created_at", "origin"
)
SELECT
  gen_random_uuid()::text,
  p."tenant_id",
  p."id",
  'NO_KNOWN_ALLERGY',
  'No known allergy',
  'Carried over from the patient record, where an empty allergy list meant the question had been asked and answered. No author was recorded at the time.',
  true,
  NULL,
  now(),
  'MIGRATED'
FROM "patients" p
WHERE p."allergies" IS NOT NULL
  AND jsonb_typeof(p."allergies") = 'array'
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(p."allergies") AS entry WHERE btrim(entry) <> ''
  )
  AND NOT EXISTS (
    SELECT 1 FROM "patient_alerts" a
    WHERE a."patient_id" = p."id"
      AND a."type" IN ('ALLERGY', 'NO_KNOWN_ALLERGY')
      AND a."active"
  );

ALTER TABLE "patient_alerts" FORCE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- THE DROP, AND WHY IT IS SAFE TO DO IT HERE
--
-- Dropping the source column in the same migration that copies it is only
-- defensible if the copy is CHECKED, so it is. Every patient who had anything
-- recorded — a list or a confirmed empty one — must now carry an alert saying
-- so, or this migration fails and nothing is dropped.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  unmigrated INT;
BEGIN
  SELECT count(*) INTO unmigrated
  FROM "patients" p
  WHERE p."allergies" IS NOT NULL
    AND jsonb_typeof(p."allergies") = 'array'
    AND NOT EXISTS (
      SELECT 1 FROM "patient_alerts" a
      WHERE a."patient_id" = p."id"
        AND a."type" IN ('ALLERGY', 'NO_KNOWN_ALLERGY')
        AND a."active"
    );

  IF unmigrated > 0 THEN
    RAISE EXCEPTION
      'Allergy backfill incomplete: % patient(s) still hold allergies with no corresponding alert. Refusing to drop patients.allergies.',
      unmigrated;
  END IF;
END $$;

ALTER TABLE "patients" DROP COLUMN "allergies";

COMMENT ON COLUMN "patient_alerts"."origin" IS
  'HUMAN — somebody recorded this, and created_by_staff_id names them. MIGRATED — '
  'carried over from patients.allergies, which had no author to name. The CHECK '
  'constraint permits a null author only for MIGRATED, and nothing in the API can '
  'write that value.';
