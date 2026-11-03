import { join } from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { SEED_DEFAULT_PANELS } from '../src/panel/default-panel-seed';

config({ path: join(__dirname, '..', '.env') });

/**
 * N-1 — SEED THE PLATFORM'S DEFAULT PANEL LIST.
 *
 * `default_panel_clinics` is platform data: no tenant column, copied into each
 * new tenant at provisioning. It has been empty since it was created, so every
 * clinic started with no panels at all.
 *
 *   npx tsx prisma/seed-default-panels.ts [--dry-run]
 *
 * FOUR RULES, and the second is the one that matters.
 *
 *  1. IDEMPOTENT. Matched on the name, which is this table's only natural key.
 *     Re-running changes nothing that is already right.
 *
 *  2. IT NEVER OVERWRITES A HUMAN EDIT. The operator owns this list — they
 *     rename rows, deactivate ones nobody uses, and add their own. A seed that
 *     reset `active` or renamed a row on every deploy would silently undo that
 *     curation, and the person who did it would not find out until a clinic was
 *     provisioned with panels they had removed. So an existing row is touched
 *     in exactly one case: its `panel_type` is NULL and this file knows one.
 *     Anything else already set is left alone and REPORTED as left alone.
 *
 *  3. IT NEVER DELETES OR DEACTIVATES. A row dropped from a future version of
 *     the list stays, because tenants provisioned from it hold panels that
 *     reference it by name and a clinic may be mid-claim against one.
 *
 *  4. NOTHING INVENTED. Names and kinds only — no portal URL, no payment term,
 *     no fee, no limit. Those are per-clinic contract facts; the setup wizard
 *     (N-2) asks for them, and until it is answered the panel reads NULL and
 *     `UNCONFIGURED`, which the screens already report.
 *
 * A DRY RUN IS AVAILABLE because this writes platform-wide data that then
 * propagates into every tenant provisioned afterwards. Same discipline as the
 * claim importer: say what will change before changing it.
 */
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const existing = await prisma.defaultPanelClinic.findMany();
  const byName = new Map(existing.map((row) => [row.name.trim().toLowerCase(), row]));

  const inserted: string[] = [];
  const classified: string[] = [];
  const untouched: string[] = [];

  for (const row of SEED_DEFAULT_PANELS) {
    const found = byName.get(row.name.trim().toLowerCase());

    if (!found) {
      inserted.push(`${row.name} (${row.panelType})`);
      if (!dryRun) {
        await prisma.defaultPanelClinic.create({
          data: { name: row.name, panelType: row.panelType },
        });
      }
      continue;
    }

    // The ONE repair: a row that predates `panel_type` and has none. Setting it
    // adds a fact nobody had recorded; it overwrites nothing.
    if (found.panelType === null) {
      classified.push(`${found.name} → ${row.panelType}`);
      if (!dryRun) {
        await prisma.defaultPanelClinic.update({
          where: { id: found.id },
          data: { panelType: row.panelType },
        });
      }
      continue;
    }

    untouched.push(
      found.panelType === row.panelType
        ? found.name
        : `${found.name} (kept ${found.panelType}, this list says ${row.panelType})`,
    );
  }

  const label = dryRun ? 'WOULD BE' : '';
  console.log(`\n  Default panel list — ${SEED_DEFAULT_PANELS.length} rows in this version\n`);
  console.log(`  added ${label}        ${inserted.length}`);
  for (const line of inserted) console.log(`                      + ${line}`);
  console.log(`  classified ${label}   ${classified.length}   (had no type; nothing overwritten)`);
  for (const line of classified) console.log(`                      · ${line}`);
  console.log(`  left alone          ${untouched.length}`);
  for (const line of untouched) console.log(`                      = ${line}`);

  // Rows the operator added or renamed. Named rather than counted, because
  // "27 rows, 20 of them mine" is the figure that tells somebody the list has
  // been curated and this seed is not the whole story.
  const seedNames = new Set(SEED_DEFAULT_PANELS.map((row) => row.name.trim().toLowerCase()));
  const operatorOwned = existing.filter((row) => !seedNames.has(row.name.trim().toLowerCase()));
  if (operatorOwned.length > 0) {
    console.log(`\n  not from this list  ${operatorOwned.length}   (added or renamed in the console; untouched)`);
    for (const row of operatorOwned) {
      console.log(`                      = ${row.name}${row.active ? '' : ' (inactive)'}`);
    }
  }

  const stillUnclassified = await prisma.defaultPanelClinic.count({ where: { panelType: null } });
  if (stillUnclassified > 0) {
    console.log(
      `\n  ${stillUnclassified} row(s) still have no kind. They are operator rows this list does not` +
        `\n  know; classify them in the platform console. A kind is never guessed from a name.`,
    );
  }

  if (dryRun) console.log('\n  DRY RUN — nothing was written. Re-run without --dry-run to apply.');
  console.log('\n  No row was deleted, deactivated or renamed by this seed.\n');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
