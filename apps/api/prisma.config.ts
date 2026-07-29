import * as fs from 'node:fs';
import * as path from 'node:path';
import { defineConfig } from 'prisma/config';

// Prisma 7 moved the connection URL used by the CLI (migrate, studio, etc.)
// out of schema.prisma and into this file. Application code instantiates
// PrismaClient with an explicit driver adapter instead — see
// src/core/prisma.service.ts. See docs/DECISIONS.md for why we're on
// current-stable Prisma rather than an older major.
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const match = /^([^#=\s][^=]*)=(.*)$/.exec(line.trim());
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim().replace(/^"(.*)"$/, '$1');
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL!,
  },
});
