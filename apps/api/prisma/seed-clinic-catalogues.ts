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
 *   npx tsx prisma/seed-clinic-catalogues.ts [--tenant <id>]
 */

const SEED_DIR = join(__dirname, 'seed-data');
// Same driver adapter the app uses (Prisma 7 requires one).
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

interface Counts {
  inserted: number;
  updated: number;
  skipped: number;
}

const blank = (): Counts => ({ inserted: 0, updated: 0, skipped: 0 });

/**
 * Every table here is under row-level security, so a bare client reads back
 * nothing at all. The app sets `app.tenant_id` inside a transaction for
 * exactly this reason (`withTenantTx`), and so does this: one transaction,
 * the GUC set as its first statement, all the work inside it.
 */
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantId);
    return fn(tx);
  }, { timeout: 120_000 });
}

async function seedDiagnoses(tx: Tx, tenantId: string): Promise<Counts & { disambiguated: string[] }> {
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
  const seenNames = new Set<string>();

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

    const existing = await tx.diagnosisCatalog.findFirst({
      where: { tenantId, icd10Code: parsed.icd10Code },
      select: { id: true },
    });
    if (existing) {
      await tx.diagnosisCatalog.update({
        where: { id: existing.id },
        data: { name, shortform: parsed.shortform, active: true },
      });
      counts.updated += 1;
    } else {
      // A placeholder row seeded earlier may already hold this NAME with no
      // code. Adopt it rather than colliding with it: same clinical concept,
      // now with the code the clinic actually uses.
      const byName = await tx.diagnosisCatalog.findFirst({
        where: { tenantId, name },
        select: { id: true },
      });
      if (byName) {
        await tx.diagnosisCatalog.update({
          where: { id: byName.id },
          data: { icd10Code: parsed.icd10Code, shortform: parsed.shortform, active: true },
        });
        counts.updated += 1;
      } else {
        await tx.diagnosisCatalog.create({
          data: {
            tenantId,
            icd10Code: parsed.icd10Code,
            name,
            shortform: parsed.shortform,
            category: 'CUSTOM',
          },
        });
        counts.inserted += 1;
      }
    }
  }
  return { ...counts, disambiguated };
}

async function seedMedications(tx: Tx, tenantId: string, clinicId: string): Promise<Counts> {
  const rows = parseCsv(readFileSync(join(SEED_DIR, 'kuwick-seed-medications.csv'), 'utf8'));
  const counts = blank();

  for (const raw of rows) {
    const parsed = parseMedicationRow(raw);
    if (!parsed) {
      counts.skipped += 1;
      continue;
    }

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

    const existing = await tx.item.findFirst({
      where: { tenantId, externalRef: parsed.externalRef },
      select: { id: true },
    });

    let itemId: string;
    if (existing) {
      await tx.item.update({ where: { id: existing.id }, data });
      itemId = existing.id;
      counts.updated += 1;
    } else {
      const created = await tx.item.create({
        data: { tenantId, externalRef: parsed.externalRef, ...data },
      });
      itemId = created.id;
      counts.inserted += 1;
    }

    // Stock is SET, not added. Re-running the seed must not multiply the
    // shelf; the export is a statement of what is there, not a delivery.
    const level = await tx.stockLevel.findFirst({
      where: { tenantId, itemId, clinicId },
      select: { id: true },
    });
    if (level) {
      await tx.stockLevel.update({
        where: { id: level.id },
        data: { quantityOnHand: parsed.stockBalance },
      });
    } else {
      await tx.stockLevel.create({
        data: { tenantId, clinicId, itemId, quantityOnHand: parsed.stockBalance },
      });
    }
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

  await withTenant(tenantId, async (tx) => {
    const clinic = await tx.clinic.findFirst({ where: { tenantId }, select: { id: true, name: true } });
    if (!clinic) throw new Error(`Tenant ${tenantId} has no clinic to hold stock.`);

    console.log(`\nSeeding clinic catalogues — tenant ${tenantId}, clinic "${clinic.name}"`);
    console.log('='.repeat(72));

    const diagnoses = await seedDiagnoses(tx, tenantId);
    console.log(
      `  diagnoses    inserted ${diagnoses.inserted}  updated ${diagnoses.updated}  skipped ${diagnoses.skipped}`,
    );
    if (diagnoses.disambiguated.length) {
      console.log(
        `               ${diagnoses.disambiguated.length} name collision(s) kept apart by their code: ` +
          diagnoses.disambiguated.join(', '),
      );
    }

    const medications = await seedMedications(tx, tenantId, clinic.id);
    console.log(
      `  medications  inserted ${medications.inserted}  updated ${medications.updated}  skipped ${medications.skipped}`,
    );

    const diagnosisTotal = await tx.diagnosisCatalog.count({ where: { tenantId } });
    const itemTotal = await tx.item.count({ where: { tenantId } });
    const imported = await tx.item.count({ where: { tenantId, externalRef: { not: null } } });
    console.log(
      `\n  catalogue now holds ${diagnosisTotal} diagnoses and ${itemTotal} items ` +
        `(${imported} imported, ${itemTotal - imported} local — the safety fixture and anything added by hand).`,
    );
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
