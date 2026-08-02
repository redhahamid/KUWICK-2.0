-- G2 closure (D-061) — a saved diagnosis is never deleted.
--
-- Removal becomes a traceable clinical correction: the row, its content, its
-- priority and its ORIGINAL attribution all survive; only record_status
-- changes, plus who removed it, when and why.

CREATE TYPE "DiagnosisRecordStatus" AS ENUM ('ACTIVE', 'REMOVED_IN_ERROR');

ALTER TABLE "diagnoses"
  ADD COLUMN "record_status"            "DiagnosisRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "removed_at"               TIMESTAMP(3),
  ADD COLUMN "removed_by_staff_id"      TEXT,
  ADD COLUMN "removed_by_name_snapshot" TEXT,
  ADD COLUMN "removed_by_role_snapshot" TEXT,
  ADD COLUMN "removal_reason"           TEXT,
  ADD COLUMN "version"                  INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "diagnoses"
  ADD CONSTRAINT "diagnoses_removed_by_staff_id_fkey"
  FOREIGN KEY ("removed_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Every existing diagnosis is ACTIVE. The column default already guarantees
-- this for rows written by the ALTER, but state it explicitly and then prove
-- it: `diagnoses` is FORCE ROW LEVEL SECURITY, so an UPDATE without
-- app.tenant_id set silently matches zero rows and reports success (D-048).
ALTER TABLE "diagnoses" NO FORCE ROW LEVEL SECURITY;

UPDATE "diagnoses" SET "record_status" = 'ACTIVE' WHERE "record_status" IS NULL;

ALTER TABLE "diagnoses" FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  not_active INTEGER;
  bogus_removal INTEGER;
BEGIN
  SELECT count(*) INTO not_active FROM "diagnoses" WHERE "record_status" <> 'ACTIVE';
  IF not_active > 0 THEN
    RAISE EXCEPTION '% existing diagnosis row(s) are not ACTIVE — migration must not change clinical state', not_active;
  END IF;

  -- No historical row may come out of this migration looking as if somebody
  -- removed it.
  SELECT count(*) INTO bogus_removal
    FROM "diagnoses"
   WHERE "removed_at" IS NOT NULL OR "removed_by_staff_id" IS NOT NULL OR "removal_reason" IS NOT NULL;
  IF bogus_removal > 0 THEN
    RAISE EXCEPTION '% row(s) carry fabricated removal attribution', bogus_removal;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- The one-primary-per-visit rule now applies to ACTIVE diagnoses only.
--
-- Without this, removing the primary diagnosis would keep occupying the slot
-- and the doctor could never designate a new one. A removed row keeps its
-- historical priority for audit; it just stops counting.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS "diagnoses_one_primary_per_visit";

CREATE UNIQUE INDEX "diagnoses_one_active_primary_per_visit"
  ON "diagnoses" ("visit_id")
  WHERE "priority" = 'PRIMARY' AND "record_status" = 'ACTIVE';

CREATE INDEX "diagnoses_tenant_visit_status_idx" ON "diagnoses" ("tenant_id", "visit_id", "record_status");
