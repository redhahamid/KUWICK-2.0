import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { standardPrescriptionFor } from '../src/clinical/standard-prescription-seed';

config({ path: join(__dirname, '..', '.env') });

/**
 * PHASE 1G — fill each medicine's standard prescription defaults.
 *
 * These are the CLINIC'S data, not SYSTEM rows: editable in Settings, and they
 * decide only what the prescribing form opens with. Editing them affects future
 * prescriptions only — nothing already prescribed or dispensed is touched,
 * because a prescription copies its values at the moment it is written.
 *
 * IT NEVER OVERWRITES A CLINIC'S EDIT. `defaultsFromSeed` marks a row this
 * script wrote. If somebody at the clinic has since changed the defaults, the
 * flag is cleared by that write and this script SKIPS the row and says so by
 * name. A seeder that silently reverts a doctor's correction is worse than one
 * that never ran — and "skipped 41" with no names is the same lie by omission
 * the reference-catalogue seeder had to fix.
 *
 * IT WRITES THE REVIEW FILE. `docs/seed-review/standard-prescriptions.csv`, one
 * row per medicine, every field, plus the BASIS (curated / form-derived / none)
 * and the reason anything was left blank. The owner is a doctor; a list of 229
 * clinical claims is not reviewable inside a database.
 *
 * HIGH-LATENCY SAFE. The reads are done once, up front; the plan is built in
 * memory; and the per-medicine updates are committed in small chunked
 * transactions rather than one long-held interactive transaction, which over a
 * cross-region link (the GitHub runner to a Supabase database) tripped Prisma's
 * transaction timeout (P2028). What gets written, and the skip rules, are
 * unchanged; re-running remains idempotent.
 *
 *   npx tsx prisma/seed-standard-prescriptions.ts [--tenant <id>] [--dry-run]
 */
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

// Updates committed per transaction — see the other catalogue seeds.
const CHUNK = 50;

const REVIEW_DIR = join(__dirname, '..', '..', '..', 'docs', 'seed-review');
const REVIEW_FILE = join(REVIEW_DIR, 'standard-prescriptions.csv');

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantId);
      return fn(tx);
    },
    { timeout: 900_000 },
  );
}

type ItemUpdate = {
  id: string;
  data: {
    defaultDoseAmount: number | null;
    defaultDoseUnitId: string | null;
    defaultFrequencyId: string | null;
    defaultDurationValue: number | null;
    defaultDurationUnit: string | null;
    defaultQuantity: number | null;
    defaultConsumptionMethodId: string | null;
    defaultsFromSeed: true;
  };
};

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const arg = process.argv.indexOf('--tenant');
  const tenantId =
    arg >= 0 ? process.argv[arg + 1] : (await prisma.tenant.findFirst({ select: { id: true } }))?.id;
  if (!tenantId) throw new Error('No tenant found. Pass --tenant <id>.');

  // Read everything once, in a single tenant-scoped transaction.
  const { unitId, frequencyId, methodId, items } = await withTenant(tenantId, async (tx) => {
    // The reference catalogues are the vocabulary these defaults point AT, so
    // a missing one is not a warning — every FK below would be null and the
    // whole run would look like it worked.
    const [units, frequencies, methods] = await Promise.all([
      tx.dosageUnit.findMany({ where: { tenantId }, select: { id: true, systemNameEn: true } }),
      tx.prescriptionFrequency.findMany({ where: { tenantId }, select: { id: true, code: true } }),
      tx.consumptionMethodRef.findMany({ where: { tenantId }, select: { id: true, methodBilingual: true } }),
    ]);
    if (units.length === 0 || frequencies.length === 0 || methods.length === 0) {
      throw new Error(
        'The prescription reference catalogues are empty. Run `npm run seed:reference --workspace=apps/api` first.',
      );
    }

    const items = await tx.item.findMany({
      where: { tenantId },
      select: {
        id: true,
        name: true,
        code: true,
        groupTag: true,
        defaultsFromSeed: true,
        defaultDoseAmount: true,
        defaultDoseUnitId: true,
        defaultFrequencyId: true,
        defaultConsumptionMethodId: true,
      },
      orderBy: { name: 'asc' },
    });

    return {
      unitId: new Map(units.map((u) => [u.systemNameEn, u.id])),
      frequencyId: new Map(frequencies.map((f) => [f.code, f.id])),
      methodId: new Map(methods.map((m) => [m.methodBilingual, m.id])),
      items,
    };
  });

  const rows: string[] = [
    [
      'medicine',
      'code',
      'group',
      'basis',
      'dose_amount',
      'dose_unit',
      'frequency',
      'duration',
      'consumption_method',
      'action',
      'note',
    ].join(','),
  ];

  let written = 0;
  let cleared = 0;
  const skipped: string[] = [];
  const unrecognised: string[] = [];
  const updates: ItemUpdate[] = [];

  for (const item of items) {
    const plan = standardPrescriptionFor(item.name);

    // Has a person at this clinic set these? Anything present that this
    // script did not write is theirs.
    const hasDefaults =
      item.defaultDoseAmount !== null ||
      item.defaultDoseUnitId !== null ||
      item.defaultFrequencyId !== null ||
      item.defaultConsumptionMethodId !== null;
    const clinicEdited = hasDefaults && !item.defaultsFromSeed;

    let action: string;
    if (clinicEdited) {
      action = 'SKIPPED — edited at this clinic';
      skipped.push(item.name);
    } else if (plan.basis === 'NONE') {
      action = 'no defaults';
      unrecognised.push(item.name);
    } else {
      action = plan.basis === 'CURATED' ? 'set (curated)' : 'set (form-derived)';
      if (!dryRun) {
        updates.push({
          id: item.id,
          data: {
            defaultDoseAmount: plan.doseAmount,
            defaultDoseUnitId: plan.doseUnit ? (unitId.get(plan.doseUnit) ?? null) : null,
            defaultFrequencyId: plan.frequency ? (frequencyId.get(plan.frequency) ?? null) : null,
            defaultDurationValue: plan.durationValue,
            defaultDurationUnit: plan.durationUnit,
            defaultQuantity: plan.quantity,
            defaultConsumptionMethodId: plan.consumptionMethod
              ? (methodId.get(plan.consumptionMethod) ?? null)
              : null,
            defaultsFromSeed: true,
          },
        });
      }
      written += 1;
      if (plan.basis === 'FORM') cleared += 1;
    }

    rows.push(
      [
        csvCell(item.name),
        csvCell(item.code),
        csvCell(item.groupTag),
        csvCell(plan.basis),
        csvCell(plan.doseAmount),
        csvCell(plan.doseUnit),
        csvCell(plan.frequency),
        csvCell(plan.durationValue ? `${plan.durationValue} ${plan.durationUnit}` : ''),
        csvCell(plan.consumptionMethod),
        csvCell(action),
        csvCell(plan.note),
      ].join(','),
    );
  }

  // Apply the planned updates in small transactions, each re-establishing the
  // tenant GUC. Nothing is written on a dry run (no updates were collected).
  for (const slice of chunk(updates, CHUNK)) {
    await withTenant(tenantId, async (tx) => {
      for (const u of slice) {
        await tx.item.update({ where: { id: u.id }, data: u.data });
      }
    });
  }

  mkdirSync(REVIEW_DIR, { recursive: true });
  writeFileSync(REVIEW_FILE, `${rows.join('\n')}\n`, 'utf8');

  console.log(`\nStandard prescriptions — tenant ${tenantId}${dryRun ? ' (DRY RUN, nothing written)' : ''}`);
  console.log(`  medicines            ${items.length}`);
  console.log(`  defaults written     ${written}  (${written - cleared} curated, ${cleared} route/unit only)`);
  console.log(`  no defaults          ${unrecognised.length}  (dosage form not recognised, or not a medicine)`);
  console.log(`  SKIPPED, clinic-set  ${skipped.length}`);
  // By NAME. A count alone cannot be acted on, and these are the rows where
  // the clinic and the platform disagree.
  for (const name of skipped) console.log(`      · ${name}`);
  console.log(`\n  Review file: docs/seed-review/standard-prescriptions.csv`);
  console.log('  Every row is a clinical claim. Correct any of them in Settings › Inventory.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
