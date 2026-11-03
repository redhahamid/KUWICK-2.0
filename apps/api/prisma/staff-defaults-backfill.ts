/**
 * ONE-OFF: STAFF ADDED BEFORE THE NEW-STAFF DEFAULTS (new-clinic UAT #2
 * re-check, 3 November 2026).
 *
 * New staff are put on the clinic's leave policy and given the next employee
 * number when they are added. People already on file are not: their profile
 * said "Annual leave: Not recorded" and they had no number. For every tenant
 * this puts each person with no leave policy on the clinic's default one
 * ("Standard leave" is made from its leave types when it has none) and gives
 * each person with no number the next one (E001…), oldest start date first.
 * Nothing already set is changed.
 *
 * A tenant holding the Hijraa branch is counted and left alone (owner's
 * instruction: do not change Hijraa data). Prints counts and numbers, no
 * names. Same code as the request path (src/workforce/new-staff-defaults.ts).
 *
 * Environment: DATABASE_URL (admin connection), BACKFILL_APPLY=true to write
 * (else a dry run that changes nothing).
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { backfillStaffDefaults } from '../src/workforce/new-staff-defaults';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required.');
  const apply = process.env.BACKFILL_APPLY === 'true';
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const tenants = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    return tx.$queryRaw<{ id: string; name: string; real_branch: boolean }[]>`
      SELECT t.id, t.name, EXISTS (SELECT 1 FROM clinics c WHERE c.tenant_id = t.id AND c.name ILIKE '%hijraa%') AS real_branch
      FROM tenants t ORDER BY t.name`;
  });
  console.log(`${apply ? 'APPLYING' : 'DRY RUN (nothing is written)'} — ${tenants.length} tenant(s).`);
  for (const tenant of tenants) {
    const result = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, true)`;
        // The Hijraa tenant is only ever counted.
        return backfillStaffDefaults(tx, tenant.id, apply && !tenant.real_branch);
      },
      { timeout: 60_000 },
    );
    const what = `${result.leavePolicyAssigned} without a leave policy, ${result.employeeNumbersGiven} without an employee number`;
    if (tenant.real_branch) console.log(`  ${tenant.name}: ${what}. Holds the Hijraa branch: LEFT AS IT IS.`);
    else if (apply) console.log(`  ${tenant.name}: ${what}. Done${result.numbers.length ? `; numbers given ${result.numbers.join(', ')}` : ''}.`);
    else console.log(`  ${tenant.name}: ${what}. Would be filled in.`);
  }
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
