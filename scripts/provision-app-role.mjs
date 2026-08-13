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
// holding synthetic `.invalid` accounts.
const password = process.env.APP_ROLE_PASSWORD ?? 'apppass';

const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query(readFileSync(sqlPath, 'utf8'));

  // Quoted by the database, then issued. Rotates on every run rather than being
  // skipped when the role already exists.
  const { rows } = await client.query('SELECT quote_literal($1) AS literal', [password]);
  await client.query(`ALTER ROLE kuwick_app WITH PASSWORD ${rows[0].literal}`);

  // Prove what was asked for, rather than assuming the statements took: this is
  // the guarantee the whole of Phase 0 rests on.
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
