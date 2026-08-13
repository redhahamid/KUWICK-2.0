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
-- Run as the database OWNER:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/provision-app-role.sql
--
-- Override the password with -v app_password='…' (defaults to the CI value,
-- which unlocks nothing but a throwaway container).
--
-- Idempotent: safe to run on every deploy.

\if :{?app_password}
\else
  \set app_password 'apppass'
\endif

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kuwick_app') THEN
    CREATE ROLE kuwick_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

-- Separate from CREATE so a re-run rotates the password rather than skipping it.
ALTER ROLE kuwick_app WITH PASSWORD :'app_password';

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
