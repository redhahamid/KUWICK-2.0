import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Runs once before the whole e2e suite (jest's `globalSetup`), in a
// separate process from `setup-env.ts` — decoupled deliberately, so this
// file's only job is "make sure kuwick_test's schema is current," not
// "make other code see the right DATABASE_URL."
export default function globalSetup(): void {
  const envTestPath = path.join(__dirname, '..', '.env.test');
  const env: Record<string, string | undefined> = { ...process.env };
  if (fs.existsSync(envTestPath)) {
    for (const line of fs.readFileSync(envTestPath, 'utf-8').split('\n')) {
      const match = /^([^#=\s][^=]*)=(.*)$/.exec(line.trim());
      if (match) {
        env[match[1].trim()] = match[2].trim().replace(/^"(.*)"$/, '$1');
      }
    }
  }

  if (!env.TEST_DATABASE_URL) {
    throw new Error(
      'TEST_DATABASE_URL is not set — copy apps/api/.env.test.example to apps/api/.env.test and fill in your local kuwick_test credentials.',
    );
  }

  // MIGRATIONS RUN AS THE OWNER, NOT AS THE APPLICATION ROLE.
  //
  // This used TEST_DATABASE_URL, which is `kuwick_app` — deliberately
  // NOSUPERUSER, NOBYPASSRLS, and deliberately NOT the owner of any table, so
  // that row-level security actually binds during the tests. That role cannot
  // CREATE TABLE and cannot ALTER a table it does not own, so any migration
  // doing either failed here and left a permanently-failed row behind, after
  // which `migrate deploy` refuses every later migration with P3009. It has
  // happened at least twice: 20260822210000 (create) and 20260828200000
  // (alter), the second only because the first had been resolved by hand.
  //
  // The owner URL is what CI already passes for exactly this reason, and what
  // the application never uses. Falling back keeps a single-URL local setup
  // working.
  const migrationUrl = env.TEST_OWNER_DATABASE_URL ?? env.TEST_DATABASE_URL;

  // Idempotent: applies any pending migrations, no-ops if already current.
  execSync('npx prisma migrate deploy', {
    cwd: path.join(__dirname, '..'),
    env: { ...env, DATABASE_URL: migrationUrl },
    stdio: 'inherit',
  });
}
