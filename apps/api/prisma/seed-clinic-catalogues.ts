import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  parseCsv,
  parseDiagnosisRow,
  parseMedicationRow,
} from '../src/inventory/seed-import';

config({ path: join(__dirname, '..', '.env') });

/**
 * KW2-Q3 — seed the clinic's real diagnosis and medication catalogues.
 *
 * IDEMPOTENT BY CONSTRUCTION. Every row is upserted on a natural key — the
 * ICD-10 code for a diagnosis, the source row's id for a medicine — so
 * running this twice updates and never duplicates. That matters more than it
 * sounds: a duplicated medicine is two stock balances for one shelf.
 *
 * IT NEVER DELETES. A medicine dropped from a later export is not removed,
 * because prescriptions reference it and a visit from last month still has to
 * render its name. Retirement is the `status` column's job.
 *
 * HIGH-LATENCY SAFE. The GitHub runner talks to a Supabase database on the
 * other side of the planet, so a single interactive transaction that does a
 * per-row round-trip for 162 diagnoses and 229 medicines blew past Prisma's
 * transaction timeout (P2028). The upsert DECISIONS and the field VALUES are
 * unchanged; only HOW they are written is: existence is resolved with one bulk
 * read per table instead of a SELECT per row, and the writes are committed in
 * small chunked transactions (each re-establishes the tenant GUC) rather than
 * one long-held one. Fewer round-trips, none of them fatal, and a partial run
 * simply resumes on the next run because every chunk that committed stays.
 *
 *   npx tsx prisma/seed-clinic-catalogues.ts [--tenant <id>]
 */

const SEED_DIR = join(__dirname, 'seed-data');
// Same driver adapter the app uses (Prisma 7 requires one).
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// Rows written per transaction. Small enough that a chunk finishes well inside
// the (already generous) timeout even on a cross-region link, large enough that
// the whole catalogue is a few dozen transactions, not hundreds.
const CHUNK = 50;

interface Counts {
  inserted: number;
  updated: number;
  skipped: number;
}

const blank = (): Counts => ({ inserted: 0, updated: 0, skipped: 0 });

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Every table here is under row-level security, so a bare client reads back
 * nothing at all. The app sets `app.tenant_id` inside a transaction for
 * exactly this reason (`withTenantTx`), and so does this: the GUC is the first
 * statement of every transaction, and all the work rides inside it.
 *
 * The timeout is deliberately large: it is a ceiling for a stuck connection,
 * not the mechanism that keeps runs short — chunking does that. On a fast local
 * database a chunk takes milliseconds; on a distant one it still finishes in
 * seconds, far under this bound.
 */
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantId);
      return fn(tx);
    },
    { timeout: 900_000 },
  );
}

async function seedDiagnoses(tenantId: string): Promise<Counts & { disambiguated: string[] }> {
  const rows = parseCsv(readFileSync(join(SEED_DIR, 'kuwick-seed-diagnosis.csv'), 'utf8'));
  const counts = blank();
  const disambiguated: string[] = [];

  // The clinic's list carries two ICD-10 codes under one name: L72.9
  // "Sebaceous cyst" (unspecified) and L72.3 (the specific one). Both are
  // real and both must stay findable, but `diagnosis_catalog` uniques on
  // NAME — a constraint the free-text "add a custom diagnosis" upsert
  // depends on, so it cannot simply be dropped.
  //
  // The later one keeps the code it already carries in its name. Nothing is
  // invented and nothing is discarded, and the run says which rows it did
  // this to rather than quietly reshaping the clinic's list.
  //
  // Disambiguation is pure string work over the CSV in file order, so it is
  // done here once, before any database round-trip — the result is identical to
  // resolving it row-by-row as the rows are written.
  const seenNames = new Set<string>();
  const planned: { icd10Code: string; name: string; shortform: string | null }[] = [];
  for (const raw of rows) {
    const parsed = parseDiagnosisRow(raw);
    if (!parsed) {
      counts.skipped += 1;
      continue;
    }
    let name = parsed.name;
    if (seenNames.has(name.toLowerCase())) {
      name = `${parsed.name} (${parsed.icd10Code})`;
      disambiguated.push(name);
    }
    seenNames.add(name.toLowerCase());
    planned.push({ icd10Code: parsed.icd10Code, name, shortform: parsed.shortform });
  }

  // One bulk read instead of a findFirst per row. diagnosis_catalog uniques on
  // NAME and the seed's own codes are unique, so these maps are 1:1 and resolve
  // exactly what the per-row lookups did.
  const existing = await withTenant(tenantId, (tx) =>
    tx.diagnosisCatalog.findMany({ where: { tenantId }, select: { id: true, icd10Code: true, name: true } }),
  );
  const byCode = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const row of existing) {
    if (row.icd10Code) byCode.set(row.icd10Code, row.id);
    byName.set(row.name.toLowerCase(), row.id);
  }

  for (const slice of chunk(planned, CHUNK)) {
    await withTenant(tenantId, async (tx) => {
      for (const p of slice) {
        const codeId = byCode.get(p.icd10Code);
        if (codeId) {
          await tx.diagnosisCatalog.update({
            where: { id: codeId },
            // SUMMARIZE, and re-stamped on every run on purpose: rows seeded
            // before this fix landed as CUSTOM, which made the whole catalogue
            // invisible to every search surface (they default to SUMMARIZE).
            // An idempotent seed must be able to REPAIR that, not just skip it.
            data: { name: p.name, shortform: p.shortform, active: true, category: 'SUMMARIZE' },
          });
          counts.updated += 1;
          continue;
        }
        // A placeholder row seeded earlier may already hold this NAME with no
        // code. Adopt it rather than colliding with it: same clinical concept,
        // now with the code the clinic actually uses.
        const nameId = byName.get(p.name.toLowerCase());
        if (nameId) {
          await tx.diagnosisCatalog.update({
            where: { id: nameId },
            data: {
              icd10Code: p.icd10Code,
              shortform: p.shortform,
              active: true,
              category: 'SUMMARIZE',
            },
          });
          counts.updated += 1;
          continue;
        }
        const created = await tx.diagnosisCatalog.create({
          data: {
            tenantId,
            icd10Code: p.icd10Code,
            name: p.name,
            shortform: p.shortform,
            // The clinic's own working list — the equivalent of 1.0's
            // "Summarize" set, not a one-off custom entry a doctor typed.
            category: 'SUMMARIZE',
          },
        });
        // Keep the maps consistent within this run so a repeated key would not
        // insert twice — the same guarantee the per-row lookups gave.
        byCode.set(p.icd10Code, created.id);
        byName.set(p.name.toLowerCase(), created.id);
        counts.inserted += 1;
      }
    });
  }

  return { ...counts, disambiguated };
}

async function seedMedications(tenantId: string, clinicId: string): Promise<Counts> {
  const rows = parseCsv(readFileSync(join(SEED_DIR, 'kuwick-seed-medications.csv'), 'utf8'));
  const counts = blank();

  const planned = [];
  for (const raw of rows) {
    const parsed = parseMedicationRow(raw);
    if (!parsed) {
      counts.skipped += 1;
      continue;
    }
    planned.push(parsed);
  }

  // Two bulk reads instead of two findFirsts per row. externalRef is unique per
  // tenant and there is one stock level per item per clinic, so these maps
  // resolve exactly what the per-row lookups did.
  const { itemByRef, levelByItem } = await withTenant(tenantId, async (tx) => {
    const items = await tx.item.findMany({
      where: { tenantId, externalRef: { not: null } },
      select: { id: true, externalRef: true },
    });
    const levels = await tx.stockLevel.findMany({
      where: { tenantId, clinicId },
      select: { id: true, itemId: true },
    });
    return {
      itemByRef: new Map(items.map((i) => [i.externalRef as string, i.id])),
      levelByItem: new Map(levels.map((l) => [l.itemId, l.id])),
    };
  });

  for (const slice of chunk(planned, CHUNK)) {
    await withTenant(tenantId, async (tx) => {
      for (const parsed of slice) {
        const data = {
          name: parsed.name,
          sourceName: parsed.sourceName,
          category: parsed.category,
          groupTag: parsed.groupTag,
          cashOnly: parsed.cashOnly,
          cost: parsed.cost,
          sellPrice: parsed.sellPrice,
          packDescription: parsed.packDescription,
          unitOfMeasure: parsed.packDescription,
          unitsPerPack: parsed.unitsPerPack,
          earliestExpiry: parsed.earliestExpiry,
          active: parsed.active,
          // EVERY imported row. The export carries no dosing data, and inventing
          // doses for real drugs is the one thing an import must never do — so
          // the behaviour is the neutral one and the defaults stay empty.
          dosingType: 'ADULT_DEFAULT' as const,
        };

        let itemId: string;
        const existingId = itemByRef.get(parsed.externalRef);
        if (existingId) {
          await tx.item.update({ where: { id: existingId }, data });
          itemId = existingId;
          counts.updated += 1;
        } else {
          const created = await tx.item.create({
            data: { tenantId, externalRef: parsed.externalRef, ...data },
          });
          itemId = created.id;
          itemByRef.set(parsed.externalRef, itemId);
          counts.inserted += 1;
        }

        // Stock is SET, not added. Re-running the seed must not multiply the
        // shelf; the export is a statement of what is there, not a delivery.
        const levelId = levelByItem.get(itemId);
        if (levelId) {
          await tx.stockLevel.update({
            where: { id: levelId },
            data: { quantityOnHand: parsed.stockBalance },
          });
        } else {
          const created = await tx.stockLevel.create({
            data: { tenantId, clinicId, itemId, quantityOnHand: parsed.stockBalance },
          });
          levelByItem.set(itemId, created.id);
        }
      }
    });
  }

  return counts;
}

async function main() {
  const tenantArg = process.argv.indexOf('--tenant');
  // `tenants` is not tenant-scoped, so this one read works without the GUC.
  const tenantId =
    tenantArg >= 0
      ? process.argv[tenantArg + 1]
      : (await prisma.tenant.findFirst({ select: { id: true } }))?.id;
  if (!tenantId) throw new Error('No tenant found. Pass --tenant <id>.');

  const clinic = await withTenant(tenantId, (tx) =>
    tx.clinic.findFirst({ where: { tenantId }, select: { id: true, name: true } }),
  );
  if (!clinic) throw new Error(`Tenant ${tenantId} has no clinic to hold stock.`);

  console.log(`\nSeeding clinic catalogues — tenant ${tenantId}, clinic "${clinic.name}"`);
  console.log('='.repeat(72));

  const diagnoses = await seedDiagnoses(tenantId);
  console.log(
    `  diagnoses    inserted ${diagnoses.inserted}  updated ${diagnoses.updated}  skipped ${diagnoses.skipped}`,
  );
  if (diagnoses.disambiguated.length) {
    console.log(
      `               ${diagnoses.disambiguated.length} name collision(s) kept apart by their code: ` +
        diagnoses.disambiguated.join(', '),
    );
  }

  const medications = await seedMedications(tenantId, clinic.id);
  console.log(
    `  medications  inserted ${medications.inserted}  updated ${medications.updated}  skipped ${medications.skipped}`,
  );

  const totals = await withTenant(tenantId, async (tx) => ({
    diagnosisTotal: await tx.diagnosisCatalog.count({ where: { tenantId } }),
    itemTotal: await tx.item.count({ where: { tenantId } }),
    imported: await tx.item.count({ where: { tenantId, externalRef: { not: null } } }),
  }));
  console.log(
    `\n  catalogue now holds ${totals.diagnosisTotal} diagnoses and ${totals.itemTotal} items ` +
      `(${totals.imported} imported, ${totals.itemTotal - totals.imported} local — the safety fixture and anything added by hand).`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
