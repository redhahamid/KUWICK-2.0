import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

config({ path: join(__dirname, '..', '.env') });

/**
 * THE PRICING DIVISOR AUDIT — report-only. Reads. Writes one CSV. Changes no row.
 *
 *   npx tsx prisma/pricing-divisor-audit.ts [--tenant <id>]
 *
 * WHY IT EXISTS, AND WHY IT RUNS BEFORE THE FORMULA.
 *
 * The dispense maths about to be written is `ceil(clinical ÷ unitsPerPack)`:
 * a course of 40 tablets against a 10-per-strip pack is 4 strips, and 4 strips
 * is what gets deducted and billed. That formula is only as good as its
 * divisor, and the divisor is a column somebody either recorded or did not.
 * `units_per_pack` is NULL for every row whose pack string did not START with
 * a number — "Box", "BOTTLE", "-" — because the importer refused to guess 1
 * (see `parseUnitsPerPack`). A missing divisor is not a small data gap: it
 * decides whether the formula prices most of the catalogue or almost none of
 * it, and therefore whether the next piece of work is the formula or the
 * curation. So the count comes first and the answer is reported before a line
 * of pricing code is written.
 *
 * TWO COLUMNS COULD BE THE DIVISOR AND THE AUDIT PRINTS BOTH.
 *
 *   units_per_pack           parsed at import from the source's own pack
 *                            string. Present where the string led with a
 *                            count ("10 BIJI / STRIP" → 10).
 *   quantity_per_stock_unit  b1 Phase 1E — the CLINIC'S number, set beside a
 *                            StockUnitRef in Settings → Inventory, because
 *                            only they know whether their strips hold 10 or
 *                            12. Nothing reads it yet.
 *
 * They are not the same fact and the second is meant to win where it is set.
 * Reporting only one would hide either an import that parsed nothing or a
 * clinic that has curated nothing.
 *
 * RLS: items is FORCE'd and tenant-keyed (D-048). Every read sets both GUCs
 * inside the transaction, or the counts come back zero and the zero looks
 * like an answer.
 */

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

interface AuditRow {
  name: string;
  code: string | null;
  category: string | null;
  groupTag: string | null;
  active: boolean;
  sellPrice: string;
  packDescription: string | null;
  unitOfMeasure: string | null;
  stockUnitName: string | null;
  unitsPerPack: number | null;
  quantityPerStockUnit: number | null;
  doseUnit: string | null;
  doseUnitSource: string;
}

function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The divisor the pricing formula would actually get, and where it came from.
 * The clinic's own number outranks the imported parse: Phase 1E exists
 * precisely because the source string is sometimes wrong about the shelf.
 */
function effectiveDivisor(row: AuditRow): { value: number | null; source: string } {
  if (row.quantityPerStockUnit !== null) return { value: row.quantityPerStockUnit, source: 'clinic (quantity_per_stock_unit)' };
  if (row.unitsPerPack !== null) return { value: row.unitsPerPack, source: 'import (units_per_pack)' };
  return { value: null, source: 'NONE — pack size not recorded' };
}

async function main() {
  const tenantArg = process.argv.indexOf('--tenant');
  const requestedTenant = tenantArg >= 0 ? process.argv[tenantArg + 1] : null;

  const tenants = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    return tx.$queryRawUnsafe<{ id: string; name: string }[]>(
      `SELECT id, name FROM tenants ORDER BY name`,
    );
  });

  const targets = requestedTenant ? tenants.filter((t) => t.id === requestedTenant) : tenants;
  if (targets.length === 0) {
    console.error(`No tenant matched ${requestedTenant ?? '(any)'}.`);
    process.exitCode = 1;
    return;
  }

  console.log('\nPRICING DIVISOR AUDIT — can the dispense formula divide?');
  console.log('='.repeat(78));

  const csv: string[] = [
    [
      'tenant',
      'medicine',
      'code',
      'category',
      'group',
      'active',
      'price_to_patient',
      'stock_unit_pack_string',
      'stock_unit_ref',
      'units_per_pack',
      'quantity_per_stock_unit',
      'effective_divisor',
      'divisor_source',
      'dose_unit',
      'dose_unit_source',
    ].join(','),
  ];

  for (const tenant of targets) {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
      return tx.$queryRawUnsafe<AuditRow[]>(
        `SELECT i.name,
                i.code,
                i.category,
                i.group_tag              AS "groupTag",
                i.active,
                i.sell_price::text       AS "sellPrice",
                i.pack_description       AS "packDescription",
                i.unit_of_measure        AS "unitOfMeasure",
                su.name                  AS "stockUnitName",
                i.units_per_pack         AS "unitsPerPack",
                i.quantity_per_stock_unit AS "quantityPerStockUnit",
                COALESCE(du.system_name_en, i.dose_unit_default) AS "doseUnit",
                CASE
                  WHEN du.system_name_en IS NOT NULL THEN 'structured (default_dose_unit_id)'
                  WHEN i.dose_unit_default IS NOT NULL THEN 'legacy text (dose_unit_default)'
                  ELSE 'none'
                END AS "doseUnitSource"
           FROM items i
           LEFT JOIN stock_units su ON su.id = i.stock_unit_id
           LEFT JOIN dosage_units du ON du.id = i.default_dose_unit_id
          ORDER BY i.name ASC`,
      );
    });

    const withDivisor = rows.filter((r) => effectiveDivisor(r).value !== null);
    const withoutDivisor = rows.filter((r) => effectiveDivisor(r).value === null);
    const activeRows = rows.filter((r) => r.active);
    const activeWithout = activeRows.filter((r) => effectiveDivisor(r).value === null);

    console.log(`\nTENANT ${tenant.name} (${tenant.id})`);
    console.log('-'.repeat(78));
    console.log(`  medicines (all rows)            ${rows.length}`);
    console.log(`  active                          ${activeRows.length}`);
    console.log('');
    console.log(`  units_per_pack SET              ${rows.filter((r) => r.unitsPerPack !== null).length}`);
    console.log(`  units_per_pack NULL             ${rows.filter((r) => r.unitsPerPack === null).length}`);
    console.log(`  quantity_per_stock_unit SET     ${rows.filter((r) => r.quantityPerStockUnit !== null).length}`);
    console.log(`  quantity_per_stock_unit NULL    ${rows.filter((r) => r.quantityPerStockUnit === null).length}`);
    console.log('');
    console.log(`  EFFECTIVE DIVISOR PRESENT       ${withDivisor.length}`);
    console.log(`  *** NULL-DIVISOR COUNT ***      ${withoutDivisor.length}   (active: ${activeWithout.length})`);
    console.log('');

    // The by-category split, because "Item" rows (arm slings, a tumbler) are
    // correctly not medicines and should not make the medicine gap look worse.
    const categories = [...new Set(rows.map((r) => r.category ?? '(none)'))].sort();
    console.log('  by category:');
    for (const category of categories) {
      const inCategory = rows.filter((r) => (r.category ?? '(none)') === category);
      const missing = inCategory.filter((r) => effectiveDivisor(r).value === null);
      console.log(
        `    ${category.padEnd(14)} ${String(inCategory.length).padStart(4)} rows, ` +
          `${String(missing.length).padStart(4)} without a divisor`,
      );
    }

    // What the missing rows have INSTEAD, since that is what a curation pass
    // would be reading: a pack string that named a container but no count.
    const packShapes = new Map<string, number>();
    for (const row of withoutDivisor) {
      const shape = (row.packDescription ?? '(no pack string)').toUpperCase();
      packShapes.set(shape, (packShapes.get(shape) ?? 0) + 1);
    }
    console.log('\n  what the divisorless rows say instead (top 12):');
    for (const [shape, n] of [...packShapes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
      console.log(`    ${String(n).padStart(4)} × ${shape}`);
    }

    const noDoseUnit = rows.filter((r) => !r.doseUnit).length;
    console.log(`\n  dose unit missing               ${noDoseUnit}`);

    for (const row of rows) {
      const divisor = effectiveDivisor(row);
      csv.push(
        [
          csvCell(tenant.name),
          csvCell(row.name),
          csvCell(row.code),
          csvCell(row.category),
          csvCell(row.groupTag),
          csvCell(row.active),
          csvCell(row.sellPrice),
          csvCell(row.packDescription),
          csvCell(row.stockUnitName),
          csvCell(row.unitsPerPack),
          csvCell(row.quantityPerStockUnit),
          csvCell(divisor.value),
          csvCell(divisor.source),
          csvCell(row.doseUnit),
          csvCell(row.doseUnitSource),
        ].join(','),
      );
    }
  }

  const outDir = join(__dirname, '..', '..', '..', 'docs', 'seed-review');
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, 'medicine-pricing-divisors.csv');
  writeFileSync(outFile, `${csv.join('\n')}\n`, 'utf8');
  console.log(`\nWrote ${outFile} (${csv.length - 1} rows)`);
  console.log('='.repeat(78));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
