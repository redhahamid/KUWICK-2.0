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

  // Idempotent: applies any pending migrations, no-ops if already current.
  execSync('npx prisma migrate deploy', {
    cwd: path.join(__dirname, '..'),
    env: { ...env, DATABASE_URL: env.TEST_DATABASE_URL },
    stdio: 'inherit',
  });
}
