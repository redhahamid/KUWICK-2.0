-- b3 PHASE F — the two document types the clinic issues and Kuwick could not.
--
-- Settings → Documents & Templates lists six things a clinic hands a patient:
-- MC, time slip, referral, memo, quarantine letter, consent. `DocumentType`
-- had four. The missing two were being issued as CUSTOM documents or on paper,
-- which is the same problem in two shapes: a time slip issued as CUSTOM cannot
-- be counted, filtered or reported on as a time slip.
--
-- A TIME SLIP NEEDS HOURS, AND NOTHING HERE COULD HOLD THEM. `start_date` and
-- `end_date` are `@db.Date` — deliberately, because an MC covers whole days and
-- storing 00:00:00 against one would invite somebody to read a time out of it.
-- A time slip is the opposite case: "attended 14:00–16:30" is two hours thirty
-- on ONE day, and the honest way to store that alongside a date column is the
-- duration itself.
--
-- DOUBLE PRECISION rather than the DECIMAL used for money. Hours are displayed,
-- summed for a report and never reconciled to the cent; the values that occur
-- in practice (half and quarter hours) are exactly representable, and a NUMERIC
-- here would mean Decimal handling in every consumer for no accuracy anybody
-- needs.
--
-- Both new enum values are added in the SAME transaction as the column on
-- purpose and safely: PostgreSQL forbids USING a new enum value in the
-- transaction that adds it, and nothing below compares against, inserts or
-- backfills one. The moment a later migration needs to (a CHECK constraint, a
-- data copy), it must be its own file — this is the trap the allergy work hit
-- on 2026-08-16.

ALTER TYPE "DocumentType" ADD VALUE 'TIME_SLIP';
ALTER TYPE "DocumentType" ADD VALUE 'CONSENT';

ALTER TABLE "documents" ADD COLUMN "hours" DOUBLE PRECISION;

COMMENT ON COLUMN "documents"."hours" IS
  'Hours attended, for a TIME_SLIP. Null on every other type: an MC covers whole '
  'days and start_date/end_date are date-only, which is why a duration needs its '
  'own column rather than a time component nobody can trust.';
