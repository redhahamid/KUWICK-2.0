-- PHASE 0 — THE APPEND-ONLY GUARANTEE, ENFORCED RATHER THAN CLAIMED.
--
-- `patient_alerts` and `label_prints` each carried a comment asserting that a
-- hard delete is "refused by PostgreSQL itself" because they omit a DELETE
-- policy under FORCE ROW LEVEL SECURITY. **That was measured and found false.**
-- RLS is not applied to a superuser, and the role the application connects as
-- is a superuser in every environment we run: the postgres image makes
-- POSTGRES_USER one, and the local container role was created that way too. A
-- plain DELETE succeeded on both tables. `REVOKE` changes nothing for a role
-- that holds every privilege — the same reason it did not save `label_prints`
-- the first time.
--
-- The owner's decision (2026-08-13) is defence in depth, and this migration is
-- the second layer of it:
--
--   1. a NON-SUPERUSER application role, so RLS and privileges actually apply
--      (created in CI's init step and asserted at boot — see
--      `assertNotSuperuser` in prisma.service.ts, which refuses to start);
--   2. BEFORE DELETE and BEFORE TRUNCATE triggers, which fire for EVERY role
--      including a superuser, so the guarantee survives a misconfigured
--      environment rather than depending on one.
--
-- TRUNCATE needs its own trigger: it is a separate command with a separate
-- privilege, and `TRUNCATE ... CASCADE` walks straight past a DELETE trigger.
-- That is the exact hole the label_prints audit found and closed with a REVOKE
-- that a superuser ignores.
--
-- Statement-level, not row-level: `DELETE FROM ... WHERE false` matches no rows
-- and must still be refused, so that "successfully deleted nothing" is never
-- read as permission to try harder.

CREATE OR REPLACE FUNCTION kuwick_refuse_append_only_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Rows in %.% are append-only and are never deleted.', TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING HINT = 'This is a medicolegal record. Deactivate or void the row instead.';
END $$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['patient_alerts', 'label_prints']
  LOOP
    -- Idempotent: these names are new, but a re-run of a migration during a
    -- recovery must not fail on "trigger already exists".
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_no_delete', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_no_truncate', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION kuwick_refuse_append_only_delete()',
      t || '_no_delete', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION kuwick_refuse_append_only_delete()',
      t || '_no_truncate', t);
  END LOOP;
END $$;

-- The correction, recorded where a reader of the schema will find it rather than
-- only in a commit message.
COMMENT ON TABLE "patient_alerts" IS
  'Append-only. Deactivation is audited in place. Enforced by THREE layers, not one: '
  'a non-superuser application role (so RLS and privileges apply at all), the RLS '
  'policies below, and BEFORE DELETE/TRUNCATE triggers that fire for every role. '
  'The original comment credited RLS alone, which was measured and found false — a '
  'superuser bypasses RLS entirely.';

COMMENT ON TABLE "label_prints" IS
  'Append-only print history. "Was this label printed, and by whom" must stay '
  'answerable. Enforced by a non-superuser application role, RLS policies, and '
  'BEFORE DELETE/TRUNCATE triggers. The REVOKE added by the earlier audit is kept '
  'as defence in depth but does not bind a superuser, which is what the '
  'application role used to be.';
