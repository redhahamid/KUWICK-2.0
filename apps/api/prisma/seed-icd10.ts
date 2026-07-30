import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import { PrismaClient, DiagnosisCategory, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

config({ path: join(__dirname, '..', '.env') });

// One-off loader for the owner-supplied ICD-10 datasets (docs/DECISIONS.md
// D-027) — Full (~5,064 entries, split across three pasted chunks) and
// Summarize (~162 entries, a curated subset). Run per-tenant since
// DiagnosisCatalog is tenant-scoped: `npx tsx prisma/seed-icd10.ts <tenantId>`.
// RLS requires app.tenant_id set in the same transaction as the write —
// this script isn't behind TENANT_SCOPED_PRISMA, so it sets it by hand,
// same pattern as apps/api/src/core/tenant-scoped-prisma.provider.ts.

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const BATCH_SIZE = 500;

function parseTsv(fileName: string): { icd10Code: string; name: string }[] {
  const raw = readFileSync(join(__dirname, 'seed-data', fileName), 'utf-8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [code, ...nameParts] = line.split('\t');
      return { icd10Code: code.trim(), name: nameParts.join('\t').trim() };
    })
    .filter((entry) => entry.icd10Code && entry.name);
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function loadCategory(tenantId: string, category: DiagnosisCategory, entries: { icd10Code: string; name: string }[]) {
  let created = 0;
  for (const batch of chunk(entries, BATCH_SIZE)) {
    const data: Prisma.DiagnosisCatalogCreateManyInput[] = batch.map((entry) => ({
      tenantId,
      icd10Code: entry.icd10Code,
      name: entry.name,
      category,
      active: true,
    }));
    const [, result] = await prisma.$transaction([
      prisma.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`,
      prisma.diagnosisCatalog.createMany({ data, skipDuplicates: true }),
    ]);
    created += result.count;
  }
  console.log(`${category}: inserted ${created} of ${entries.length} (rest skipped as already present)`);
}

async function main() {
  const tenantId = process.argv[2];
  if (!tenantId) {
    throw new Error('Usage: tsx prisma/seed-icd10.ts <tenantId>');
  }

  const summarize = parseTsv('icd10-summarize.tsv');
  const full = [
    ...parseTsv('icd10-full-part1.tsv'),
    ...parseTsv('icd10-full-part2.tsv'),
    ...parseTsv('icd10-full-part3.tsv'),
  ];

  // De-duplicate by name within each set — the pasted source has a small
  // number of repeated entries (e.g. codes reused across chapters).
  const dedupe = (entries: { icd10Code: string; name: string }[]) => {
    const seen = new Map<string, { icd10Code: string; name: string }>();
    for (const entry of entries) {
      seen.set(entry.name.toLowerCase(), entry);
    }
    return Array.from(seen.values());
  };

  await loadCategory(tenantId, DiagnosisCategory.SUMMARIZE, dedupe(summarize));
  await loadCategory(tenantId, DiagnosisCategory.FULL, dedupe(full));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
