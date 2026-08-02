-- G2a (D-059) — Diagnosis priority + real attribution.
--
-- Additive only. No existing diagnosis row is deleted, rewritten, or given a
-- clinical priority it never had.

CREATE TYPE "DiagnosisPriority" AS ENUM ('PRIMARY', 'SECONDARY');

ALTER TABLE "diagnoses"
  ADD COLUMN "priority"                   "DiagnosisPriority",
  ADD COLUMN "added_by_staff_id"          TEXT,
  ADD COLUMN "added_by_name_snapshot"     TEXT,
  ADD COLUMN "added_by_role_snapshot"     TEXT,
  ADD COLUMN "added_at"                   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "legacy_attribution_unknown" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "diagnoses"
  ADD CONSTRAINT "diagnoses_added_by_staff_id_fkey"
  FOREIGN KEY ("added_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Backfill. `diagnoses` is FORCE ROW LEVEL SECURITY, so an UPDATE here without
-- app.tenant_id set matches ZERO rows and reports success (D-048, and the same
-- trap that silently no-opped a C0 backfill). Lift FORCE for the backfill and
-- put it straight back.
-- ---------------------------------------------------------------------------
ALTER TABLE "diagnoses" NO FORCE ROW LEVEL SECURITY;

-- addedAt mirrors the row's real creation time rather than "now", so a
-- historical diagnosis does not appear to have been recorded at deploy time.
UPDATE "diagnoses" SET "added_at" = "created_at";

-- Every pre-existing row is explicitly marked as having no recorded author.
-- Attribution is NOT inferred from the attending doctor, the clinical-note
-- author, the visit creator or whoever runs this migration — any of those
-- would be a fabricated medicolegal claim about who made a clinical entry.
-- priority stays NULL: "Priority not recorded".
UPDATE "diagnoses"
   SET "legacy_attribution_unknown" = true
 WHERE "added_by_staff_id" IS NULL;

ALTER TABLE "diagnoses" FORCE ROW LEVEL SECURITY;

-- Prove the backfill actually touched rows rather than being filtered to zero.
DO $$
DECLARE
  unstamped INTEGER;
  fabricated INTEGER;
BEGIN
  SELECT count(*) INTO unstamped FROM "diagnoses" WHERE "added_at" <> "created_at";
  IF unstamped > 0 THEN
    RAISE EXCEPTION 'added_at backfill did not apply to % row(s) — check RLS bracketing', unstamped;
  END IF;

  SELECT count(*) INTO fabricated FROM "diagnoses" WHERE "priority" IS NOT NULL;
  IF fabricated > 0 THEN
    RAISE EXCEPTION '% historical row(s) were given a priority — nothing may be backfilled', fabricated;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- At most ONE primary diagnosis per visit.
--
-- A partial unique index rather than a service-level check alone: two
-- concurrent "mark as primary" requests can both pass an application read and
-- then both write. The database is the only place that can settle that race.
-- The second transaction fails with 23505, which the service reports as 409.
-- Rows with a NULL priority are not covered by the index, so any number of
-- "priority not recorded" diagnoses remain valid.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "diagnoses_one_primary_per_visit"
  ON "diagnoses" ("visit_id")
  WHERE "priority" = 'PRIMARY';

CREATE INDEX "diagnoses_tenant_added_by_idx" ON "diagnoses" ("tenant_id", "added_by_staff_id");
