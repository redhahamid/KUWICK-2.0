-- b0 — ATTACHMENT FILING TAG. The approved canvas (PDF p.2) shows each
-- attachment chip carrying the kind of thing it is: photo, lab, letter. The
-- reference itself proves the tag cannot be derived — `referral-hosp.jpg` is
-- an image file and a LETTER — so it is stored, with who filed it and when.
--
-- Backfill is a guess made explicit: an image becomes PHOTO, anything else
-- becomes LAB, and `category_set_by_staff_id` stays NULL on every backfilled
-- row so a reader can tell a default apart from a decision somebody made.

CREATE TYPE "VisitAttachmentCategory" AS ENUM ('PHOTO', 'LAB', 'LETTER');

ALTER TABLE "visit_attachments"
    ADD COLUMN "category" "VisitAttachmentCategory" NOT NULL DEFAULT 'PHOTO',
    ADD COLUMN "category_set_by_staff_id" TEXT,
    ADD COLUMN "category_set_at" TIMESTAMP(3);

ALTER TABLE "visit_attachments"
    ADD CONSTRAINT "visit_attachments_category_set_by_staff_id_fkey"
    FOREIGN KEY ("category_set_by_staff_id") REFERENCES "staff"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Backfill. `visit_attachments` is FORCE ROW LEVEL SECURITY, so an UPDATE run
-- here without `app.tenant_id` set matches ZERO rows and still reports success
-- (D-048 — the same trap the document/attachment integrity migration had to
-- bracket). Lift FORCE for the statement, put it straight back, then prove the
-- rows actually moved rather than trusting the "UPDATE 0" that would have
-- looked identical.
-- ---------------------------------------------------------------------------
ALTER TABLE "visit_attachments" NO FORCE ROW LEVEL SECURITY;

UPDATE "visit_attachments"
   SET "category" = 'LAB'
 WHERE lower("mime_type") NOT LIKE 'image/%';

ALTER TABLE "visit_attachments" FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  bad INTEGER;
BEGIN
  SELECT count(*) INTO bad
    FROM "visit_attachments"
   WHERE lower("mime_type") NOT LIKE 'image/%' AND "category" <> 'LAB';
  IF bad > 0 THEN
    RAISE EXCEPTION '% non-image attachment(s) were left tagged PHOTO', bad;
  END IF;

  -- And nothing that IS an image may have been swept up by the guess.
  SELECT count(*) INTO bad
    FROM "visit_attachments"
   WHERE lower("mime_type") LIKE 'image/%' AND "category" <> 'PHOTO';
  IF bad > 0 THEN
    RAISE EXCEPTION '% image attachment(s) came out of the backfill mis-tagged', bad;
  END IF;

  -- A backfilled tag is a default, never somebody's filing decision.
  SELECT count(*) INTO bad
    FROM "visit_attachments"
   WHERE "category_set_by_staff_id" IS NOT NULL OR "category_set_at" IS NOT NULL;
  IF bad > 0 THEN
    RAISE EXCEPTION '% attachment(s) came out of the backfill attributed to a person', bad;
  END IF;
END $$;
