#!/usr/bin/env node
/**
 * PHASE 0 — create the non-superuser application role.
 *
 * Runs `apps/api/prisma/provision-app-role.sql` through node + `pg` rather than
 * through `psql`. That is not a preference: two CI runs died at this step before
 * the cause was understood. The GitHub runner has node and this repo's own `pg`
 * dependency; it does not reliably carry a `psql` binary, and a provisioning
 * step that fails for want of an unrelated client tells you nothing about the
 * thing it was provisioning.
 *
 * The SQL file is therefore plain SQL with no psql meta-commands, and the
 * PASSWORD — which cannot be a bound parameter in `ALTER ROLE` — is quoted by
 * PostgreSQL itself via `quote_literal($1)` rather than assembled here, because
 * an escaping bug in that particular statement is an auth bypass.
 *
 *   APP_ROLE_PASSWORD=… node scripts/provision-app-role.mjs [DATABASE_URL]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(here, '..', 'apps', 'api', 'prisma', 'provision-app-role.sql');

const connectionString = process.argv[2] ?? process.env.DATABASE_URL;
if (!connectionString) {
  console.error('provision-app-role: DATABASE_URL is not set.');
  process.exit(1);
}
// Defaults to the CI value, which unlocks nothing but a throwaway container
// holding synthetic `.invalid` accounts — and is therefore ONLY accepted for
// a loopback database. On any remote host the default would set a role with
// full table access to a publicly-known password (Railway exposes Postgres on
// a public proxy), so a remote target must state a real password explicitly.
const password = process.env.APP_ROLE_PASSWORD ?? 'apppass';
if (!process.env.APP_ROLE_PASSWORD) {
  let host = '';
  try {
    host = new URL(connectionString).hostname;
  } catch {
    // An unparseable URL fails at connect with pg's own error; no opinion here.
  }
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (host && !loopback) {
    console.error(
      `provision-app-role: refusing to set the default CI password on remote host "${host}". ` +
        'Set APP_ROLE_PASSWORD explicitly.',
    );
    process.exit(1);
  }
}

const client = new pg.Client({ connectionString });
await client.connect();
try {
  // PREFLIGHT — before altering anything, learn who we are and whether we may.
  //
  // On Railway/CI the connecting user is a superuser and every path below is
  // trivially allowed. On Supabase the connecting `postgres` is NOT a
  // superuser: it holds CREATEROLE, so it can CREATE a role (and, on
  // PostgreSQL 16+, is automatically granted ADMIN on what it creates), but it
  // CANNOT alter a role it does not administer. If `kuwick_app` was created by
  // a different admin (e.g. through the Supabase SQL editor), `ALTER ROLE
  // kuwick_app …` fails with a bare "permission denied to alter role". We
  // detect that here and say exactly what to do, instead of letting the ALTER
  // surface the symptom with no cause.
  const pre = await client.query(`
    SELECT
      current_user AS me,
      (SELECT rolsuper      FROM pg_roles WHERE rolname = current_user) AS me_superuser,
      (SELECT rolcreaterole FROM pg_roles WHERE rolname = current_user) AS me_createrole,
      EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kuwick_app')       AS role_exists
  `);
  const { me, me_superuser, me_createrole, role_exists } = pre.rows[0];

  // Can THIS user administer kuwick_app (own it / hold ADMIN option on it)? A
  // superuser always can. Only asked when the role already exists — pg_has_role
  // errors on a missing role, and a role we are about to create needs no check.
  let canAdmin = me_superuser === true;
  if (role_exists && !canAdmin) {
    const { rows } = await client.query(
      "SELECT pg_has_role(current_user, 'kuwick_app', 'MEMBER WITH ADMIN OPTION') AS has_admin",
    );
    canAdmin = rows[0].has_admin === true;
  }

  console.log(
    `provision-app-role: connected as "${me}" ` +
      `(superuser=${me_superuser === true}, createrole=${me_createrole === true}); ` +
      `kuwick_app ${role_exists ? `exists, administrable-by-me=${canAdmin}` : 'does not exist (will create)'}.`,
  );

  // The one situation that produced the bare "permission denied to alter role":
  // the role exists and we cannot administer it. Stop with an actionable fix
  // BEFORE issuing any ALTER, so the operator sees the cause, not the symptom.
  if (role_exists && !canAdmin) {
    throw new Error(
      `the kuwick_app role already exists but this database user ("${me}") cannot administer it ` +
        '(it was created by a different admin, so this connection holds no ADMIN option on it). Any ' +
        'ALTER ROLE would fail with "permission denied to alter role".\n' +
        '  ONE-TIME FIX: open the Supabase Dashboard → SQL Editor and run exactly this line:\n' +
        '      DROP ROLE kuwick_app;\n' +
        '  then re-run this workflow. It will recreate the role under this user and continue.\n' +
        '  This is safe: on a fresh database kuwick_app owns no data — it is only a login role.',
    );
  }

  // CREATE (if missing) + assert flags + grants. The flag re-assertion inside
  // the SQL is itself wrapped (see provision-app-role.sql) so a permission
  // failure there names that statement rather than surfacing bare.
  try {
    await client.query(readFileSync(sqlPath, 'utf8'));
  } catch (error) {
    if (error && error.code === '42501') {
      throw new Error(
        `permission denied while running the provisioning SQL as "${me}" ` +
          `(PostgreSQL said: ${error.message}). If kuwick_app already exists and is owned by another ` +
          'admin, run "DROP ROLE kuwick_app;" in the Supabase SQL editor and re-run; otherwise ensure ' +
          'the connection uses the Supabase project owner role.',
      );
    }
    throw error;
  }

  // Rotate the password. Quoted by the database (never assembled here), then
  // issued as its own statement so a permission failure is attributed to it.
  try {
    const { rows } = await client.query('SELECT quote_literal($1) AS literal', [password]);
    await client.query(`ALTER ROLE kuwick_app WITH PASSWORD ${rows[0].literal}`);
  } catch (error) {
    if (error && error.code === '42501') {
      throw new Error(
        `permission denied on "ALTER ROLE kuwick_app WITH PASSWORD …" as "${me}". The role exists but ` +
          'is not administrable by this user. Run "DROP ROLE kuwick_app;" in the Supabase SQL editor ' +
          'and re-run this workflow.',
      );
    }
    throw error;
  }

  // SECURITY VERIFICATION — unchanged. Prove what was asked for, rather than
  // assuming the statements took: this is the guarantee the whole of Phase 0
  // rests on.
  const { rows: check } = await client.query(
    'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1',
    ['kuwick_app'],
  );
  if (check.length === 0) {
    throw new Error('kuwick_app was not created.');
  }
  if (check[0].rolsuper || check[0].rolbypassrls) {
    throw new Error(
      `kuwick_app is superuser=${check[0].rolsuper} bypassrls=${check[0].rolbypassrls} — ` +
        'row-level security would not apply to it. Refusing to report success.',
    );
  }
  console.log('provision-app-role: kuwick_app ready (NOSUPERUSER NOBYPASSRLS), privileges granted.');
} catch (error) {
  console.error(`provision-app-role: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
