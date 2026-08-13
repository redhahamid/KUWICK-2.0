#!/usr/bin/env node
/**
 * PHASE 0 — run migrations as the OWNER, then let the app run as the APP ROLE.
 *
 * `start:prod` is `migrate deploy && node dist/main`, so both used to use one
 * connection string. That is fine while the application connects as a
 * superuser, and breaks the moment it does not: `kuwick_app` is deliberately
 * NOSUPERUSER with no CREATE on the schema, so `prisma migrate deploy` as that
 * role fails with `permission denied for schema public` — measured, not
 * assumed — and the service never starts.
 *
 * Two roles for two jobs, which is the whole point of Phase 0:
 *
 *   MIGRATE_DATABASE_URL — the OWNER. Creates and alters objects.
 *   DATABASE_URL         — `kuwick_app`. Runs the application, under RLS.
 *
 * If `MIGRATE_DATABASE_URL` is not set, this falls back to `DATABASE_URL` and
 * behaves exactly as before — so local development and CI, where one role does
 * both jobs, are unchanged and need no new variable.
 *
 * The override is scoped to THIS child process. Nothing after it sees the
 * owner's credentials, so a mistake here cannot silently hand the running
 * application a superuser connection — which is the failure this whole phase
 * exists to prevent.
 */
import { spawnSync } from 'node:child_process';

const migrateUrl = process.env.MIGRATE_DATABASE_URL?.trim();
const appUrl = process.env.DATABASE_URL;

if (!appUrl && !migrateUrl) {
  console.error('migrate-deploy: neither DATABASE_URL nor MIGRATE_DATABASE_URL is set.');
  process.exit(1);
}

if (migrateUrl) {
  console.log('migrate-deploy: applying migrations as the MIGRATE role (MIGRATE_DATABASE_URL).');
} else {
  console.log('migrate-deploy: MIGRATE_DATABASE_URL not set — using DATABASE_URL for migrations.');
}

const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: migrateUrl || appUrl },
  // Windows shells need this; harmless elsewhere.
  shell: process.platform === 'win32',
});

if (result.error) {
  console.error(`migrate-deploy: could not run prisma: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
