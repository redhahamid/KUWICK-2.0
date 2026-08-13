import { join } from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  SEED_CONSUMPTION_METHODS,
  SEED_DOSAGE_UNITS,
  SEED_FREQUENCIES,
  SEED_INDICATIONS,
  SEED_STOCK_UNITS,
} from '../src/clinical/prescription-reference-seed';

config({ path: join(__dirname, '..', '.env') });

/**
 * b1 PHASE 1 — seed the platform's prescription vocabulary into a tenant.
 *
 * IDEMPOTENT AND REPAIRING. Every row upserts on its natural key and every
 * re-run rewrites the SYSTEM row's fields back to what the platform says they
 * are. That second half is the lesson from the diagnosis outage: a seed that
 * can only INSERT cannot fix 162 rows it wrote wrongly the first time, and the
 * repair had to be added under pressure. This one repairs from the outset.
 *
 * IT DOES NOT TAKE OVER A CLINIC'S ROW. Where a CUSTOM row already holds a
 * platform key — a clinic invented "QDS" before the platform shipped it — the
 * platform default is NOT applied and the clinic's row is left exactly as it
 * is. Relabelling it would silently change what is already printed on
 * dispensed labels, which is worse than the duplicate being avoided.
 *
 * That skip is REPORTED, never silent. "The platform default for TDS was not
 * applied because this clinic owns a row with that code" is precisely the kind
 * of fact the diagnosis outage taught us cannot be left for somebody to
 * notice: a seed that says "repaired 6" when it meant 7 is a seed that lies by
 * omission.
 *
 * IT NEVER DELETES, and could not if it wanted to — the tables carry BEFORE
 * DELETE and BEFORE TRUNCATE triggers that refuse. A row dropped from a later
 * version of this list is DEACTIVATED, never removed, because prescriptions
 * already printed reference it.
 *
 * CUSTOM rows are never touched. They are the clinic's, including their
 * `active` flag.
 *
 *   npx tsx prisma/seed-reference-catalogs.ts [--tenant <id>]
 */
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

interface Counts {
  inserted: number;
  repaired: number;
  retired: number;
  /** Platform keys a CUSTOM row already owns, so the default was not applied. */
  clinicOwned: string[];
}

const blank = (): Counts => ({ inserted: 0, repaired: 0, retired: 0, clinicOwned: [] });

async function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantId);
      return fn(tx);
    },
    { timeout: 120_000 },
  );
}

/**
 * One upsert-and-repair pass over a catalogue.
 *
 * Generic on purpose: five catalogues with the same platform semantics should
 * not be five hand-written loops that drift apart in which fields they repair.
 */
async function seedCatalog<Row>(
  label: string,
  rows: Row[],
  ops: {
    /** Find the existing row by its natural key. */
    find: (row: Row) => Promise<{ id: string; origin: string } | null>;
    /** How to name a row when reporting a collision. */
    describe: (row: Row) => string;
    create: (row: Row, sortOrder: number) => Promise<unknown>;
    /** Rewrite the platform's fields onto an existing SYSTEM row. */
    repair: (id: string, row: Row, sortOrder: number) => Promise<unknown>;
    /** SYSTEM rows this list no longer contains. */
    retireMissing: (keep: Row[]) => Promise<number>;
  },
): Promise<Counts> {
  const counts = blank();
  for (const [index, row] of rows.entries()) {
    const existing = await ops.find(row);
    if (!existing) {
      await ops.create(row, index);
      counts.inserted += 1;
      continue;
    }
    // A clinic row that collides with a platform key is left alone: the clinic
    // said it first, and overwriting somebody's own vocabulary with ours
    // because the names matched is worse than the duplicate we are avoiding.
    // Recorded so the run SAYS it happened.
    if (existing.origin !== 'SYSTEM') {
      counts.clinicOwned.push(ops.describe(row));
      continue;
    }
    await ops.repair(existing.id, row, index);
    counts.repaired += 1;
  }
  counts.retired = await ops.retireMissing(rows);
  void label;
  return counts;
}

async function main(): Promise<void> {
  const arg = process.argv.indexOf('--tenant');
  const tenantId =
    arg >= 0
      ? process.argv[arg + 1]
      : // `tenants` is not tenant-scoped, so this read needs no GUC.
        (await prisma.tenant.findFirst({ select: { id: true } }))?.id;
  if (!tenantId) throw new Error('No tenant found. Pass --tenant <id>.');

  await withTenant(tenantId, async (tx) => {
    console.log(`\nSeeding prescription reference catalogues — tenant ${tenantId}`);

    const frequencies = await seedCatalog('frequencies', SEED_FREQUENCIES, {
      find: (row) =>
        tx.prescriptionFrequency.findFirst({
          where: { tenantId, code: row.code },
          select: { id: true, origin: true },
        }),
      describe: (row) => row.code,
      create: (row, sortOrder) =>
        tx.prescriptionFrequency.create({
          data: { tenantId, ...row, origin: 'SYSTEM', active: true, sortOrder },
        }),
      repair: (id, row, sortOrder) =>
        tx.prescriptionFrequency.update({
          where: { id },
          data: { ...row, origin: 'SYSTEM', active: true, sortOrder },
        }),
      retireMissing: async (keep) => {
        const result = await tx.prescriptionFrequency.updateMany({
          where: { tenantId, origin: 'SYSTEM', active: true, code: { notIn: keep.map((r) => r.code) } },
          data: { active: false },
        });
        return result.count;
      },
    });

    const units = await seedCatalog('dosage units', SEED_DOSAGE_UNITS, {
      find: (row) =>
        tx.dosageUnit.findFirst({
          where: { tenantId, systemNameEn: row.systemNameEn },
          select: { id: true, origin: true },
        }),
      describe: (row) => row.systemNameEn,
      create: (row, sortOrder) =>
        tx.dosageUnit.create({ data: { tenantId, ...row, origin: 'SYSTEM', active: true, sortOrder } }),
      repair: (id, row, sortOrder) =>
        tx.dosageUnit.update({ where: { id }, data: { ...row, origin: 'SYSTEM', active: true, sortOrder } }),
      retireMissing: async (keep) => {
        const result = await tx.dosageUnit.updateMany({
          where: {
            tenantId,
            origin: 'SYSTEM',
            active: true,
            systemNameEn: { notIn: keep.map((r) => r.systemNameEn) },
          },
          data: { active: false },
        });
        return result.count;
      },
    });

    const methods = await seedCatalog('consumption methods', SEED_CONSUMPTION_METHODS, {
      find: (row) =>
        tx.consumptionMethodRef.findFirst({
          where: { tenantId, methodBilingual: row.methodBilingual },
          select: { id: true, origin: true },
        }),
      describe: (row) => row.methodBilingual,
      create: (row, sortOrder) =>
        tx.consumptionMethodRef.create({
          data: { tenantId, ...row, origin: 'SYSTEM', active: true, sortOrder },
        }),
      repair: (id, row, sortOrder) =>
        tx.consumptionMethodRef.update({
          where: { id },
          data: { ...row, origin: 'SYSTEM', active: true, sortOrder },
        }),
      retireMissing: async (keep) => {
        const result = await tx.consumptionMethodRef.updateMany({
          where: {
            tenantId,
            origin: 'SYSTEM',
            active: true,
            methodBilingual: { notIn: keep.map((r) => r.methodBilingual) },
          },
          data: { active: false },
        });
        return result.count;
      },
    });

    const indications = await seedCatalog('indications', SEED_INDICATIONS, {
      find: (row) =>
        tx.indicationPreset.findFirst({
          where: { tenantId, labelEn: row.labelEn },
          select: { id: true, origin: true },
        }),
      describe: (row) => row.labelEn,
      create: (row, sortOrder) =>
        tx.indicationPreset.create({ data: { tenantId, ...row, origin: 'SYSTEM', active: true, sortOrder } }),
      repair: (id, row, sortOrder) =>
        tx.indicationPreset.update({ where: { id }, data: { ...row, origin: 'SYSTEM', active: true, sortOrder } }),
      retireMissing: async (keep) => {
        const result = await tx.indicationPreset.updateMany({
          where: { tenantId, origin: 'SYSTEM', active: true, labelEn: { notIn: keep.map((r) => r.labelEn) } },
          data: { active: false },
        });
        return result.count;
      },
    });

    const stockUnits = await seedCatalog(
      'stock units',
      SEED_STOCK_UNITS.map((name) => ({ name })),
      {
        find: (row) =>
          tx.stockUnitRef.findFirst({ where: { tenantId, name: row.name }, select: { id: true, origin: true } }),
        describe: (row) => row.name,
        create: (row, sortOrder) =>
          tx.stockUnitRef.create({ data: { tenantId, ...row, origin: 'SYSTEM', active: true, sortOrder } }),
        repair: (id, row, sortOrder) =>
          tx.stockUnitRef.update({ where: { id }, data: { ...row, origin: 'SYSTEM', active: true, sortOrder } }),
        retireMissing: async (keep) => {
          const result = await tx.stockUnitRef.updateMany({
            where: { tenantId, origin: 'SYSTEM', active: true, name: { notIn: keep.map((r) => r.name) } },
            data: { active: false },
          });
          return result.count;
        },
      },
    );

    const report = (name: string, counts: Counts) => {
      console.log(
        `  ${name.padEnd(21)} inserted ${String(counts.inserted).padStart(3)}  ` +
          `repaired ${String(counts.repaired).padStart(3)}  retired ${counts.retired}`,
      );
      if (counts.clinicOwned.length > 0) {
        console.log(
          `  ${' '.repeat(21)} NOT applied — this clinic owns a row with the same key: ` +
            counts.clinicOwned.join(', '),
        );
      }
    };

    report('frequencies', frequencies);
    report('dosage units', units);
    report('consumption methods', methods);
    report('indications', indications);
    report('stock units', stockUnits);
    console.log(
      '\n  All seeded as SYSTEM: locked in Settings, refused by the API, editable only by re-running this.',
    );
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
