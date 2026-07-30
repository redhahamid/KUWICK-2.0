import * as fs from 'node:fs';
import * as path from 'node:path';

// Runs via jest's `setupFiles`, before any test file (and therefore before
// PrismaService reads process.env.DATABASE_URL) — mirrors the tiny .env
// loader in prisma.config.ts rather than adding a dotenv dependency for
// one file.
const envTestPath = path.join(__dirname, '..', '.env.test');
if (fs.existsSync(envTestPath)) {
  for (const line of fs.readFileSync(envTestPath, 'utf-8').split('\n')) {
    const match = /^([^#=\s][^=]*)=(.*)$/.exec(line.trim());
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim().replace(/^"(.*)"$/, '$1');
      process.env[key] = value;
    }
  }
}

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL is not set — copy apps/api/.env.test.example to apps/api/.env.test and fill in your local kuwick_test credentials.',
  );
}

// docs/CODING_STANDARDS.md §5: integration tests run against a disposable
// test database, never kuwick_dev. Overriding DATABASE_URL here means
// PrismaService picks up kuwick_test the moment it's constructed, with no
// individual test file needing to know about the swap.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
