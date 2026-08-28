-- PHASE 0 — the application's database role.
--
-- ONE file, run by CI and by whoever provisions a real database, so the two
-- cannot drift. It was two copies of the same SQL for about an hour: one in
-- ci.yml as a heredoc and one in STAGING_DEPLOYMENT.md as prose. The heredoc's
-- terminator was indented inside a YAML block scalar, which never terminates a
-- `<<'SQL'` (only `<<-` strips leading whitespace, and only tabs at that), so
-- the step failed and both CI jobs stopped at it. A single file run with
-- `psql -f` has no quoting or indentation to get wrong.
--
-- WHY IT EXISTS: row-level security is not applied to a superuser, nor to a
-- role with BYPASSRLS. The postgres image makes POSTGRES_USER a superuser, so
-- until this role existed, every tenant-isolation policy in the schema was
-- unenforced in CI and locally — measured, not assumed.
--
-- Run as the database OWNER, through the script that owns the password:
--   APP_ROLE_PASSWORD='…' node scripts/provision-app-role.mjs
--
-- Executed by node + `pg`, NOT by psql — deliberately. Two CI runs died at this
-- step before that was understood: the GitHub runner has node and this repo's
-- own `pg` dependency, and it does not reliably have a `psql` binary. A
-- provisioning step that depends on a client this project never otherwise uses
-- is a step that fails for a reason unrelated to what it is provisioning.
--
-- Therefore NO psql meta-commands in this file (`\if`, `\set`, `:'var'`): it
-- must be executable as plain SQL.
--
-- Idempotent: safe to run on every deploy.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kuwick_app') THEN
    CREATE ROLE kuwick_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

-- The PASSWORD is set separately, by the script that runs this file, because a
-- password cannot be a bound parameter in `ALTER ROLE` and building the literal
-- by hand is how an escaping bug becomes an auth bypass. The script asks
-- PostgreSQL to quote it (`SELECT quote_literal($1)`) and then issues the
-- statement — so the escaping is done by the database, not by us.

-- And re-assert the flags every run. A role granted SUPERUSER or BYPASSRLS by
-- hand for one migration, then left that way, is exactly how this guarantee
-- would be lost again — silently, because everything would keep working.
ALTER ROLE kuwick_app WITH NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

GRANT USAGE ON SCHEMA public TO kuwick_app;

-- Tables that exist now.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO kuwick_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kuwick_app;

-- And tables a future migration adds, so a new table is not invisible to the
-- application until somebody remembers to re-grant.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kuwick_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO kuwick_app;

-- TRUNCATE is deliberately NOT granted, anywhere. It is a separate privilege
-- that RLS does not filter, and withholding it from a non-superuser is itself
-- one of the append-only guarantees.
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM kuwick_app;

-- APPEND-ONLY CARVE-OUT. The broad grant above re-opens UPDATE/DELETE on
-- every table — including the audit tables that migrations deliberately
-- closed (visit_workflow_events per D-083, appointment_events and
-- appointment_form_answers per the a_history_anyone_can_rewrite migration).
-- Those migrations REVOKE from the role that RUNS migrations and from
-- PUBLIC, but kuwick_app's privileges come from THIS file — and this file
-- re-runs on every deploy AND runs again after `migrate deploy` in CI, so
-- without this block every provisioning run silently reinstated the
-- privileges the migrations withdrew. RLS-without-a-policy and the BEFORE
-- triggers still refused the writes (measured: UPDATE 0, "append-only"
-- exception), but a defense in depth where one layer quietly evaporates on
-- each deploy is two layers pretending to be three.
--
-- Guarded per-table: on a FRESH database this file legitimately runs before
-- migrations have created these tables (PHASE 0), and a REVOKE on a missing
-- table would abort the whole provisioning.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'visit_workflow_events',
    'appointment_events',
    'appointment_form_answers',
    -- Wave-1 finance: money received is a historical fact. UPDATE stays
    -- granted (the append-only TRIGGER allows exactly two stamped columns and
    -- refuses everything else); DELETE does not, at any level.
    'payments',
    -- Wave-2 stock: the movement ledger. StockLevel is derived from exactly
    -- these rows, so a rewritable movement is a rewritable stock balance.
    'stock_movements',
    -- Wave-3 panel: a claim's own timeline, which is what an argument with an
    -- outside party months later is conducted from.
    'claim_events',
    -- Wave-4 payroll: the correction mechanism for a locked run. Reversing an
    -- adjustment is another adjustment.
    'payroll_adjustments'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      IF t = 'payments' THEN
        EXECUTE format('REVOKE DELETE, TRUNCATE ON TABLE %I FROM kuwick_app', t);
      ELSE
        EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON TABLE %I FROM kuwick_app', t);
      END IF;
    END IF;
  END LOOP;
END $$;
