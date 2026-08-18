import { join } from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * WHICH TEST INVOICES TO IGNORE.
 *
 * Before the pricing fix, a medication line was billed as
 * `prescription.quantity x Item.sellPrice` — a course counted in TABLETS
 * multiplied by a price charged per STRIP. A ten-capsule course of Oseltamivir
 * invoiced at RM 1,550.00 instead of RM 155.00.
 *
 * The fix converts first (`ceil(clinical / divisor)`), so lines written since
 * the deploy are right. The ones written before it are still sitting on
 * staging at the old figures, and they look like billing defects to anybody
 * testing today.
 *
 * THIS SCRIPT ONLY READS. It writes nothing, changes nothing, and voids
 * nothing. Reissuing a document that was already printed and handed over is
 * not a script's decision, and rewriting a submitted e-Invoice is not a
 * decision at all. The output is a list to disregard, not a work queue.
 *
 *   npx tsx prisma/list-dose-priced-invoice-lines.ts [--tenant <id>]
 */

config({ path: join(__dirname, '..', '.env') });

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

interface Row {
  invoice_number: string;
  invoice_status: string;
  created_at: Date;
  patient_name: string;
  description: string;
  billed_quantity: number;
  clinical_quantity: number;
  divisor: number;
  unit_price: string;
  billed_amount: string;
  correct_quantity: number;
  correct_amount: string;
}

async function main() {
  const flag = process.argv.indexOf('--tenant');
  const only = flag >= 0 ? process.argv[flag + 1] : null;

  const tenants = await prisma.tenant.findMany({
    where: only ? { id: only } : {},
    select: { id: true, name: true },
  });

  for (const tenant of tenants) {
    // RLS: the GUC is set as the transaction's first statement, exactly as the
    // app does it. A bare client reads back nothing at all.
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenant.id);

      // The test is the arithmetic itself, not a date cutoff: a line whose
      // billed quantity is the DOSE count while the medicine has a real pack
      // size was priced per dose against a pack price. Lines written since the
      // fix carry the converted quantity and do not match.
      return tx.$queryRawUnsafe<Row[]>(`
        SELECT
          inv."invoice_number",
          inv."status"::text        AS invoice_status,
          inv."created_at",
          pat."name"                AS patient_name,
          line."description",
          line."quantity"           AS billed_quantity,
          rx."quantity"             AS clinical_quantity,
          COALESCE(it."quantity_per_stock_unit", it."units_per_pack") AS divisor,
          line."unit_price"::text,
          line."amount"::text       AS billed_amount,
          CEIL(rx."quantity"::numeric
               / COALESCE(it."quantity_per_stock_unit", it."units_per_pack"))::int AS correct_quantity,
          ROUND(line."unit_price"
                * CEIL(rx."quantity"::numeric
                       / COALESCE(it."quantity_per_stock_unit", it."units_per_pack")), 2)::text
                                    AS correct_amount
        FROM "invoice_lines" line
        JOIN "invoices"      inv ON inv."id"  = line."invoice_id"
        JOIN "visits"        vis ON vis."id"  = inv."visit_id"
        JOIN "patients"      pat ON pat."id"  = vis."patient_id"
        JOIN "prescriptions" rx  ON rx."id"  = line."source_prescription_id"
        JOIN "items"         it  ON it."id"  = rx."item_id"
        WHERE line."cancelled_at" IS NULL
          AND COALESCE(it."quantity_per_stock_unit", it."units_per_pack") > 1
          -- Billed the dose count...
          AND line."quantity" = rx."quantity"
          -- ...where the pack count is a different number.
          AND line."quantity" <> CEIL(rx."quantity"::numeric
              / COALESCE(it."quantity_per_stock_unit", it."units_per_pack"))
        ORDER BY inv."created_at" DESC, inv."invoice_number", line."description"
      `);
    });

    console.log(`\n=== ${tenant.name} (${tenant.id}) ===`);
    if (rows.length === 0) {
      console.log('No invoice lines were priced per dose unit. Nothing to ignore here.');
      continue;
    }

    let overcharge = 0;
    for (const r of rows) {
      const billed = Number(r.billed_amount);
      const correct = Number(r.correct_amount);
      overcharge += billed - correct;
      console.log(
        [
          r.invoice_number.padEnd(18),
          r.invoice_status.padEnd(10),
          new Date(r.created_at).toISOString().slice(0, 10),
          r.patient_name.padEnd(24),
          r.description.slice(0, 34).padEnd(34),
          `billed ${String(r.billed_quantity).padStart(4)} x ${r.unit_price.padStart(8)} = ${billed.toFixed(2).padStart(10)}`,
          `| correct ${String(r.correct_quantity).padStart(3)} (${r.clinical_quantity} at ${r.divisor} per unit) = ${correct.toFixed(2)}`,
        ].join('  '),
      );
    }
    console.log(
      `\n${rows.length} line${rows.length === 1 ? '' : 's'} across these invoices, ` +
        `RM ${overcharge.toFixed(2)} of the totals is the dose-vs-pack error. Read only — nothing was changed.`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
