/**
 * DOES A PANEL'S FEE SPLIT BY DATE, OR INTERLEAVE? (G-8)
 *
 * The question the owner asked on 3 November 2026, and the exact instruction:
 * "First check whether the values split by date. If yes, it is PanelFeeTerm
 * history (no new feature). If not, per-claim override with a required reason."
 *
 *   npx tsx prisma/reports/panel-fee-value-variance.ts
 *   npx tsx prisma/reports/panel-fee-value-variance.ts --json
 *
 * WHY THIS IS A REPORT AND NOT AN ANSWER IN A DOCUMENT. The evidence lives in
 * the clinic's workbook, which is deliberately not in this repository, and
 * `PANEL_LEGACY_WORKFLOW_AUDIT.md` §4.2 records only the counts — "2,261
 * claims at one fee value, 7 at a different one" — not the dates. A count
 * cannot distinguish a fee that changed in March from seven typing mistakes,
 * and those two findings lead to opposite builds: one is already-shipped
 * `PanelFeeTerm` history, the other is a new per-claim override. Guessing which
 * would mean building the wrong one, so this computes it from the claims
 * instead, and can be re-run when more of them have been imported.
 *
 * HOW IT DECIDES is in `src/panel/fee-value-variance.ts` — the deciding rule
 * is pure arithmetic and is unit-tested there. This file reads the claims,
 * reduces each to the fee rate it implies, groups them, and prints the verdict.
 *
 * STRAY IS NOT A VERDICT, IT IS A REQUEST TO LOOK. The report names the claims
 * so somebody can open them, and says so.
 *
 * IT NEEDS A ROLE THAT CAN READ `tenants` — same as the fee-treatment impact
 * report, and for the same reason: row-level security hides that table from the
 * application role, and a report that silently reads zero rows and concludes
 * "nothing to decide" is worse than one that refuses to run.
 */
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
// The deciding rule lives in `src` as pure arithmetic so it can be unit-tested
// against cases nobody has imported yet. This file is the I/O around it.
import {
  classifyFeeVariance,
  FEE_VARIANCE_ADVICE,
  impliedRate,
  type FeeRateGroup,
  type FeeVarianceVerdict,
} from '../../src/panel/fee-value-variance';

config({ path: `${__dirname}/../../.env` });

const CONNECTION = process.env.REPORT_DATABASE_URL ?? process.env.DATABASE_URL;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: CONNECTION }),
});

interface Group extends FeeRateGroup {
  examples: string[];
}

const day = (date: Date | null) => (date === null ? null : date.toISOString().slice(0, 10));

async function main() {
  const asJson = process.argv.includes('--json');

  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });
  if (tenants.length === 0) {
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
    // SCOPED TWICE, and `where: { tenantId }` is the half that works here.
    // Row-level security does not bind the owner/migration role this report
    // connects as, so relying on `set_config` alone would read every tenant's
    // panels on every iteration — see the note in
    // `panel-fee-treatment-impact.ts`, where exactly that was measured.
    const panels = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenant.id);
      return tx.panelClinic.findMany({
        where: { tenantId: tenant.id },
        select: {
          id: true,
          name: true,
          claimFeeType: true,
          claimFeeValue: true,
          claimBatches: {
            select: {
              lines: {
                select: {
                  id: true,
                  claimedAmount: true,
                  feeAmount: true,
                  panelClaimNo: true,
                  legacyServiceDate: true,
                  createdAt: true,
                  // THE SERVICE DATE of a Kuwick claim is its VISIT's, which
                  // is what a contract term is dated against.
                  invoice: { select: { visit: { select: { checkInAt: true } } } },
                },
              },
            },
          },
        },
      });
    });

    for (const panel of panels) {
      const lines = panel.claimBatches.flatMap((batch) => batch.lines);
      const bearing = lines.filter((line) => Number(line.feeAmount) > 0);
      if (bearing.length === 0) continue;

      const byRate = new Map<number, Group>();
      for (const line of bearing) {
        const claimed = Number(line.claimedAmount);
        const fee = Number(line.feeAmount);
        // The rate the claim implies, in the panel's own shape. A PERCENT panel
        // is compared as a percentage; everything else as flat ringgit.
        const rate = impliedRate(panel.claimFeeType, claimed, fee);

        // THE SERVICE DATE, which is what a contract term is dated against —
        // never `createdAt`, which for an imported claim is the day somebody
        // ran the importer and would put a decade of claims on one afternoon.
        const dated = line.legacyServiceDate ?? line.invoice?.visit?.checkInAt ?? null;
        const date = day(dated);

        const group =
          byRate.get(rate) ?? { rate, claims: 0, from: null, to: null, examples: [] };
        group.claims += 1;
        if (date !== null) {
          if (group.from === null || date < group.from) group.from = date;
          if (group.to === null || date > group.to) group.to = date;
        }
        if (group.examples.length < 5) {
          group.examples.push(line.panelClaimNo ?? line.id);
        }
        byRate.set(rate, group);
      }

      const groups = [...byRate.values()].sort((a, b) => b.claims - a.claims);
      const verdict = classifyFeeVariance(groups);

      report.push({
        tenant: tenant.name,
        panel: panel.name,
        feeType: panel.claimFeeType,
        configuredValue: panel.claimFeeValue === null ? null : Number(panel.claimFeeValue),
        feeBearingClaims: bearing.length,
        undatedClaims: bearing.filter(
          (line) => (line.legacyServiceDate ?? line.invoice?.visit?.checkInAt ?? null) === null,
        ).length,
        verdict,
        groups,
      });
    }
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (report.length === 0) {
    console.log('\n  No fee-bearing claims found, so there is nothing to classify yet.\n');
    return;
  }

  console.log('\n  PANEL FEE VALUES — does the value split by date? (G-8)\n');
  for (const row of report) {
    const groups = row.groups as Group[];
    const unit = row.feeType === 'PERCENT' ? '%' : 'RM';
    console.log(`  ${row.panel}  —  ${row.verdict}`);
    console.log(
      `    ${row.feeBearingClaims} fee-bearing claim(s), configured at ` +
        `${row.configuredValue ?? 'nothing'}${row.configuredValue === null ? '' : unit}` +
        `${(row.undatedClaims as number) > 0 ? `, ${row.undatedClaims} with no service date` : ''}`,
    );
    for (const group of groups) {
      const span = group.from === null ? 'no dated claims' : `${group.from} → ${group.to}`;
      console.log(
        `      ${unit}${group.rate}  ×${group.claims}  ${span}` +
          (groups.length > 1 ? `   e.g. ${group.examples.join(', ')}` : ''),
      );
    }
    if (row.verdict !== 'SINGLE') console.log(`    → ${FEE_VARIANCE_ADVICE[row.verdict as FeeVarianceVerdict]}`);
    console.log('');
  }

  const needsAFeature = report.filter((row) => row.verdict === 'INTERLEAVED');
  console.log(
    needsAFeature.length === 0
      ? '  NO panel needs the per-claim fee override. Every varying fee either changed on a\n' +
          '  date — which `PanelFeeTerm` already handles — or is a handful of rows to check.\n'
      : `  ${needsAFeature.length} panel(s) genuinely used two fee values at once: ` +
          `${needsAFeature.map((row) => row.panel).join(', ')}.\n  These need the per-claim override with a required reason.\n`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
