import { join } from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

config({ path: join(__dirname, '..', '.env') });

// G4.5s — report-only audit of the STANDARD_SERVICE / TASK_ORDER split.
// Reads. Writes nothing. Safe to run at any time.
//
//   npx tsx prisma/g45s-direct-service-audit.ts
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  // order_services is FORCE'd like every clinical table, and the bypass GUC
  // does not cover the tenant-keyed policies (D-048). Query per tenant with
  // app.tenant_id set, or every count silently comes back zero — the exact
  // trap that produced a wrong figure in the G4c1 audit.
  const tenants = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    return tx.$queryRawUnsafe<{ id: string; name: string }[]>(`SELECT id, name FROM tenants ORDER BY name`);
  });

  console.log('\nG4.5s — DIRECT SERVICE AUDIT');
  console.log('='.repeat(78));

  let grandTotals: Record<string, number> = {};

  for (const tenant of tenants) {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;

      const byStatus = await tx.$queryRawUnsafe<{ order_type: string; status: string; n: bigint }[]>(
        `SELECT order_type, status, COUNT(*) AS n FROM order_services
         GROUP BY order_type, status ORDER BY order_type, status`,
      );

      // Are direct services reaching an invoice at all today?
      const billing = await tx.$queryRawUnsafe<
        { order_type: string; status: string; n: bigint; billed: bigint }[]
      >(
        `SELECT os.order_type, os.status, COUNT(*) AS n,
                COUNT(DISTINCT il.source_order_service_id) AS billed
           FROM order_services os
           LEFT JOIN invoice_lines il ON il.source_order_service_id = os.id
          GROUP BY os.order_type, os.status`,
      );

      // The thing a unique constraint would have to survive.
      const dupes = await tx.$queryRawUnsafe<{ source_order_service_id: string; n: bigint }[]>(
        `SELECT source_order_service_id, COUNT(*) AS n FROM invoice_lines
          WHERE source_order_service_id IS NOT NULL
          GROUP BY source_order_service_id HAVING COUNT(*) > 1`,
      );

      // completedAt is what a corrected STANDARD_SERVICE should carry. Where
      // it is missing on a COMPLETED row there is nothing truthful to backfill.
      const missingCompletedAt = await tx.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT COUNT(*) AS n FROM order_services
          WHERE order_type = 'STANDARD_SERVICE' AND status = 'COMPLETED' AND completed_at IS NULL`,
      );

      // A direct service that somehow carries task artefacts would block a
      // clean reclassification.
      const withTaskArtefacts = await tx.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT COUNT(*) AS n FROM order_services os
          WHERE os.order_type = 'STANDARD_SERVICE'
            AND (os.result IS NOT NULL OR os.form_template_id IS NOT NULL
                 OR EXISTS (SELECT 1 FROM attachments a WHERE a.order_service_id = os.id))`,
      );

      return { byStatus, billing, dupes, missingCompletedAt, withTaskArtefacts };
    });

    if (rows.byStatus.length === 0) continue;

    console.log(`\ntenant ${tenant.name}`);
    for (const r of rows.byStatus) {
      const key = `${r.order_type}/${r.status}`;
      grandTotals[key] = (grandTotals[key] ?? 0) + Number(r.n);
      const b = rows.billing.find((x) => x.order_type === r.order_type && x.status === r.status);
      console.log(
        `  ${r.order_type.padEnd(17)} ${r.status.padEnd(12)} ${String(r.n).padStart(4)}` +
          `   billed: ${String(b ? Number(b.billed) : 0).padStart(4)}`,
      );
    }
    console.log(`  duplicate invoice lines per order : ${rows.dupes.length}`);
    console.log(`  STANDARD_SERVICE COMPLETED without completed_at : ${rows.missingCompletedAt[0].n}`);
    console.log(`  STANDARD_SERVICE carrying result/form/attachment: ${rows.withTaskArtefacts[0].n}`);
  }

  console.log('\nAcross all tenants');
  for (const [key, n] of Object.entries(grandTotals).sort()) {
    console.log(`  ${key.padEnd(32)} ${String(n).padStart(4)}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
