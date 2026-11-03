/**
 * THE FINANCIAL IMPACT OF SUPERSEDING D-041.
 *
 * Owner requirement (2026-08-31): "Add a migration/audit report showing the
 * financial impact of correcting the old D-041 behaviour — number of affected
 * claims, previous expected receivable total, corrected expected receivable
 * total, total overstatement caused by old logic."
 *
 * Run it against any database, before or after the migration:
 *
 *   npx ts-node prisma/reports/panel-fee-treatment-impact.ts
 *   npx ts-node prisma/reports/panel-fee-treatment-impact.ts --json
 *
 * IT NEEDS A ROLE THAT CAN READ `tenants`. Row-level security hides that table
 * from the application role, so the report connects on `REPORT_DATABASE_URL`
 * (the migration/owner role) when one is set, and refuses to report "nothing to
 * correct" when it in fact cannot see anything — a financial-impact report that
 * silently reads zero rows is worse than one that will not run.
 *
 * It is deliberately a REPORT, not a one-off script embedded in the migration:
 * the same numbers have to be reproducible months later when somebody asks how
 * big the correction was, and a figure that can only be quoted from a commit
 * message is a figure nobody can check.
 *
 * WHAT IT COMPARES. For every claim line, what D-041 would have expected
 * (`claimed + fee`) against what the claim's own recorded treatment expects
 * now. The difference is the overstatement the old logic produced — on a
 * withheld-fee claim that is TWICE the fee, because the fee was added where it
 * should have been subtracted.
 */
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

config({ path: `${__dirname}/../../.env` });

const CONNECTION = process.env.REPORT_DATABASE_URL ?? process.env.DATABASE_URL;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: CONNECTION }),
});

/** Cents, because money. */
const cents = (value: unknown) => Math.round(Number(value ?? 0) * 100);
const rm = (c: number) => `RM${(c / 100).toFixed(2)}`;

async function main() {
  const asJson = process.argv.includes('--json');

  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });
  if (tenants.length === 0) {
    // Never report "nothing to correct" from an empty read. Under the
    // application role, `tenants` is hidden by row-level security and this
    // query legitimately returns zero rows on a database full of claims.
    console.error(
      'No tenants are visible on this connection.\n' +
        'Row-level security hides `tenants` from the application role, so this report needs the\n' +
        'migration/owner role. Set REPORT_DATABASE_URL to it and run again.',
    );
    process.exitCode = 2;
    return;
  }
  const report: Record<string, unknown>[] = [];

  for (const tenant of tenants) {
    // SCOPED TWICE, AND THE EXPLICIT ONE IS THE LOAD-BEARING HALF.
    //
    // The `set_config` below is the right thing to do and was, until
    // 2026-11-03, the ONLY thing being done — which made this report wrong on
    // precisely the connection it tells you to use. Row-level security does
    // not bind a SUPERUSER or a role with BYPASSRLS, and `REPORT_DATABASE_URL`
    // is the migration/owner role, which is both. So every tenant iteration
    // read EVERY tenant's claims: measured on a database with 525 tenants, the
    // report printed 525 rows carrying the identical 164 claims and the
    // identical RM1,952 overstatement — the whole database repeated once per
    // tenant, under 525 different clinic names.
    //
    // That is the worst possible failure for this particular report. Its own
    // docstring says it must be run against production before any prior panel
    // receivable figure is quoted, so a per-clinic overstatement that is
    // actually the group total would have been quoted at a clinic.
    //
    // `where: { tenantId }` is therefore explicit and NOT a belt-and-braces
    // nicety. The `set_config` stays so the report is also correct if somebody
    // runs it as the application role.
    const lines = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenant.id);
      return tx.claimBatchLine.findMany({
        where: { tenantId: tenant.id },
        select: {
          id: true,
          claimedAmount: true,
          feeAmount: true,
          feeTreatment: true,
          claimBatch: { select: { panelClinic: { select: { id: true, name: true } } } },
        },
      });
    });
    if (lines.length === 0) continue;

    const byPanel = new Map<
      string,
      { name: string; treatment: string; claims: number; feeBearing: number; oldCents: number; newCents: number }
    >();
    let feeBearing = 0;
    let oldTotal = 0;
    let newTotal = 0;

    for (const line of lines) {
      const claimed = cents(line.claimedAmount);
      const fee = cents(line.feeAmount);
      // What D-041 said: claimed + fee, whatever the panel's terms.
      const oldExpected = claimed + fee;
      // What the claim's own recorded treatment says now.
      const newExpected =
        line.feeTreatment === 'ADDED_TO_RECEIVABLE'
          ? claimed + fee
          : line.feeTreatment === 'WITHHELD_FROM_CLAIM'
            ? claimed - fee
            : claimed;

      oldTotal += oldExpected;
      newTotal += newExpected;
      if (fee > 0) feeBearing += 1;

      const panel = line.claimBatch.panelClinic;
      const bucket = byPanel.get(panel.id) ?? {
        name: panel.name,
        treatment: line.feeTreatment,
        claims: 0,
        feeBearing: 0,
        oldCents: 0,
        newCents: 0,
      };
      bucket.claims += 1;
      if (fee > 0) bucket.feeBearing += 1;
      bucket.oldCents += oldExpected;
      bucket.newCents += newExpected;
      byPanel.set(panel.id, bucket);
    }

    const entry = {
      tenant: tenant.name,
      claims: lines.length,
      /** Claims the correction can possibly touch — a zero-fee claim cannot move. */
      feeBearingClaims: feeBearing,
      /** Claims whose expected receivable actually changed. */
      affectedClaims: lines.filter((line) => cents(line.feeAmount) > 0 && line.feeTreatment !== 'ADDED_TO_RECEIVABLE')
        .length,
      previousExpectedReceivable: oldTotal / 100,
      correctedExpectedReceivable: newTotal / 100,
      overstatement: (oldTotal - newTotal) / 100,
      byPanel: [...byPanel.values()]
        .map((b) => ({
          panel: b.name,
          treatment: b.treatment,
          claims: b.claims,
          feeBearingClaims: b.feeBearing,
          previousExpectedReceivable: b.oldCents / 100,
          correctedExpectedReceivable: b.newCents / 100,
          overstatement: (b.oldCents - b.newCents) / 100,
        }))
        .sort((a, b) => b.overstatement - a.overstatement),
    };
    report.push(entry);

    if (!asJson) {
      console.log(`\n=== ${tenant.name} ===`);
      console.log(`  claims                        : ${entry.claims}`);
      console.log(`  fee-bearing claims            : ${entry.feeBearingClaims}`);
      console.log(`  claims whose expectation moved: ${entry.affectedClaims}`);
      console.log(`  previous expected receivable  : ${rm(oldTotal)}   (D-041: claimed + fee)`);
      console.log(`  corrected expected receivable : ${rm(newTotal)}`);
      console.log(`  OVERSTATEMENT under old logic : ${rm(oldTotal - newTotal)}`);
      if (entry.byPanel.length > 0) {
        console.log('\n  by panel:');
        for (const p of entry.byPanel) {
          console.log(
            `    ${p.panel.padEnd(34)} ${String(p.claims).padStart(4)} claims  ` +
              `${p.treatment.padEnd(20)} was ${String(p.previousExpectedReceivable.toFixed(2)).padStart(10)}  ` +
              `now ${String(p.correctedExpectedReceivable.toFixed(2)).padStart(10)}  ` +
              `over ${p.overstatement.toFixed(2)}`,
          );
        }
      }
    }
  }

  if (asJson) console.log(JSON.stringify(report, null, 2));
  else if (report.length === 0) console.log('No claim lines in any tenant — nothing to correct.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
