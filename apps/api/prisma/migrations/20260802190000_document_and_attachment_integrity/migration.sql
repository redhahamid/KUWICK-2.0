-- G3a (D-062) — clinical documents and attachments are never permanently
-- erased by normal application use.
--
-- Three hard deletes are replaced by audited status changes. The underlying
-- FILES are not touched: an audited removal stops unlinking them, so an
-- authorised history request can still retrieve the image or result.

CREATE TYPE "DocumentRecordStatus"   AS ENUM ('ACTIVE', 'VOIDED');
CREATE TYPE "AttachmentRecordStatus" AS ENUM ('ACTIVE', 'REMOVED_IN_ERROR');

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------
ALTER TABLE "documents"
  ADD COLUMN "record_status"            "DocumentRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "voided_at"                TIMESTAMP(3),
  ADD COLUMN "voided_by_staff_id"       TEXT,
  ADD COLUMN "voided_by_name_snapshot"  TEXT,
  ADD COLUMN "voided_by_role_snapshot"  TEXT,
  ADD COLUMN "void_reason"              TEXT,
  ADD COLUMN "version"                  INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "documents"
  ADD CONSTRAINT "documents_voided_by_staff_id_fkey"
  FOREIGN KEY ("voided_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Visit attachments (otoscope, wound, dermatology images, scanned reports)
-- ---------------------------------------------------------------------------
ALTER TABLE "visit_attachments"
  ADD COLUMN "record_status"             "AttachmentRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "removed_at"                TIMESTAMP(3),
  ADD COLUMN "removed_by_staff_id"       TEXT,
  ADD COLUMN "removed_by_name_snapshot"  TEXT,
  ADD COLUMN "removed_by_role_snapshot"  TEXT,
  ADD COLUMN "removal_reason"            TEXT,
  ADD COLUMN "version"                   INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "visit_attachments"
  ADD CONSTRAINT "visit_attachments_removed_by_staff_id_fkey"
  FOREIGN KEY ("removed_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Order/procedure attachments (lab results, ECG traces, procedure photos)
-- ---------------------------------------------------------------------------
ALTER TABLE "attachments"
  ADD COLUMN "record_status"             "AttachmentRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "removed_at"                TIMESTAMP(3),
  ADD COLUMN "removed_by_staff_id"       TEXT,
  ADD COLUMN "removed_by_name_snapshot"  TEXT,
  ADD COLUMN "removed_by_role_snapshot"  TEXT,
  ADD COLUMN "removal_reason"            TEXT,
  ADD COLUMN "version"                   INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "attachments"
  ADD CONSTRAINT "attachments_removed_by_staff_id_fkey"
  FOREIGN KEY ("removed_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Backfill. All three tables are FORCE ROW LEVEL SECURITY, so an UPDATE here
-- without app.tenant_id set matches ZERO rows and reports success (D-048).
-- Bracket every one of them, then prove nothing came out wrong.
-- ---------------------------------------------------------------------------
ALTER TABLE "documents"         NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "visit_attachments" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "attachments"       NO FORCE ROW LEVEL SECURITY;

UPDATE "documents"         SET "record_status" = 'ACTIVE' WHERE "record_status" IS NULL;
UPDATE "visit_attachments" SET "record_status" = 'ACTIVE' WHERE "record_status" IS NULL;
UPDATE "attachments"       SET "record_status" = 'ACTIVE' WHERE "record_status" IS NULL;

ALTER TABLE "documents"         FORCE ROW LEVEL SECURITY;
ALTER TABLE "visit_attachments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "attachments"       FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  bad INTEGER;
BEGIN
  SELECT count(*) INTO bad FROM "documents" WHERE "record_status" <> 'ACTIVE';
  IF bad > 0 THEN RAISE EXCEPTION '% document(s) did not migrate as ACTIVE', bad; END IF;

  SELECT count(*) INTO bad FROM "visit_attachments" WHERE "record_status" <> 'ACTIVE';
  IF bad > 0 THEN RAISE EXCEPTION '% visit attachment(s) did not migrate as ACTIVE', bad; END IF;

  SELECT count(*) INTO bad FROM "attachments" WHERE "record_status" <> 'ACTIVE';
  IF bad > 0 THEN RAISE EXCEPTION '% order attachment(s) did not migrate as ACTIVE', bad; END IF;

  -- Nothing may come out of this migration looking as if somebody voided or
  -- removed it.
  SELECT count(*) INTO bad FROM "documents" WHERE "voided_at" IS NOT NULL OR "void_reason" IS NOT NULL;
  IF bad > 0 THEN RAISE EXCEPTION '% document(s) carry fabricated void attribution', bad; END IF;

  SELECT count(*) INTO bad FROM "visit_attachments" WHERE "removed_at" IS NOT NULL OR "removal_reason" IS NOT NULL;
  IF bad > 0 THEN RAISE EXCEPTION '% visit attachment(s) carry fabricated removal attribution', bad; END IF;

  SELECT count(*) INTO bad FROM "attachments" WHERE "removed_at" IS NOT NULL OR "removal_reason" IS NOT NULL;
  IF bad > 0 THEN RAISE EXCEPTION '% order attachment(s) carry fabricated removal attribution', bad; END IF;
END $$;

CREATE INDEX "documents_tenant_visit_status_idx"          ON "documents" ("tenant_id", "visit_id", "record_status");
CREATE INDEX "visit_attachments_tenant_visit_status_idx"  ON "visit_attachments" ("tenant_id", "visit_id", "record_status");
CREATE INDEX "attachments_tenant_order_status_idx"        ON "attachments" ("tenant_id", "order_service_id", "record_status");
