import { join } from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  FIXTURE_TAG,
  assertFixturesAllowed,
  findFixturePatients,
  retireFixturePatients,
} from './fixture-support';

config({ path: join(__dirname, '..', '.env') });

// D-072 — the retirement procedure for the G4.5 Canvas review record.
//
// `g45-canvas-populate.ts` is deliberately NOT self-cleaning: the reviewer
// needs V-000338 to still be there. That makes it the one fixture in this
// repository with no automatic end, so it gets an explicit one.
//
// Report what exists (safe, the default):
//   KUWICK_ALLOW_FIXTURES=yes npx tsx prisma/g45-fixture-retire.ts
//
// Actually remove it, AFTER Dr Redha's visual review is complete:
//   KUWICK_ALLOW_FIXTURES=yes npx tsx prisma/g45-fixture-retire.ts --confirm
//
// Deterministic reset — remove, then rebuild an identical record:
//   ... --confirm && KUWICK_ALLOW_FIXTURES=yes npx tsx prisma/g45-canvas-populate.ts
//
// The rebuilt visit gets the NEXT visit number, not V-000338 again. The
// allocator is monotonic by design (D-068); a reset that reused the number
// would be re-introducing the bug G4c1 fixed.
const PATIENT_PREFIX = `${FIXTURE_TAG} G45 Canvas Patient`;
const CONFIRM = process.argv.includes('--confirm');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  // Same fail-closed guard as every other fixture script: local database,
  // not production, and an explicit opt-in. This one DELETES clinical rows,
  // so the guard matters more here than anywhere else.
  assertFixturesAllowed();

  const tenants = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    return tx.$queryRawUnsafe<{ id: string; name: string }[]>(`SELECT id, name FROM tenants ORDER BY name`);
  });

  console.log(`\nG4.5 FIXTURE LEDGER — patients named "${PATIENT_PREFIX}…"`);
  console.log('='.repeat(78));

  const found: { tenant: { id: string; name: string }; records: Awaited<ReturnType<typeof findFixturePatients>> }[] = [];
  for (const tenant of tenants) {
    const records = await findFixturePatients(prisma, tenant.id, PATIENT_PREFIX);
    if (records.length === 0) continue;
    found.push({ tenant, records });
    console.log(`\ntenant ${tenant.name}  (${tenant.id})`);
    for (const record of records) {
      console.log(`  patient ${record.patientName}`);
      console.log(`    id      ${record.patientId}`);
      console.log(`    visits  ${record.visitNumbers.join(', ') || '(none)'}`);
      console.log(`    files   ${record.filePaths.length}`);
    }
  }

  if (found.length === 0) {
    console.log('\nNothing found. The review record has already been retired, or was never built here.');
    return;
  }

  const tenantCount = found.length;
  if (tenantCount > 1) {
    console.log(`\n  NOTE: present in ${tenantCount} tenants. Expected exactly one development tenant.`);
  }

  if (!CONFIRM) {
    console.log('\nDRY RUN — nothing was deleted.');
    console.log('Re-run with --confirm to retire the records listed above.');
    console.log('Do NOT run --confirm until Dr Redha has completed the G4.5 visual review.');
    return;
  }

  for (const { tenant, records } of found) {
    await retireFixturePatients(prisma, tenant.id, records);
    console.log(`\nretired ${records.length} fixture patient(s) from ${tenant.name}`);
  }

  const remaining = (
    await Promise.all(tenants.map((t) => findFixturePatients(prisma, t.id, PATIENT_PREFIX)))
  ).flat();
  console.log(remaining.length === 0 ? 'verified: none remain' : `WARNING: ${remaining.length} still present`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
