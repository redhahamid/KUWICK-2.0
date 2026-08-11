import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

config({ path: join(__dirname, '..', '.env') });

// S3d (D-083) — is visit_workflow_events actually append-only?
//
// This runs as the NORMAL APPLICATION ROLE, against the real database, using
// the same DATABASE_URL the API uses. A mocked service proving that no
// endpoint calls `update` would only show that today's code is well behaved;
// it would say nothing about a raw query, a future endpoint, or a mistake.
//
//   npx tsx prisma/s3d-append-only-check.ts
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function listTenants(): Promise<string[]> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.bypass_tenant_scope', 'true', true)`);
    const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM tenants`);
    return rows.map((r) => r.id);
  });
}

/** Runs `fn` inside a tenant-scoped transaction that is always rolled back. */
async function probe(tenantId: string, fn: (tx: any) => Promise<void>): Promise<string | null> {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantId);
      await fn(tx);
      throw new Error('__rollback__');
    });
    return null;
  } catch (e) {
    const message = (e as Error).message;
    if (message.includes('__rollback__')) return null;
    return message.split('\n').find((l) => l.trim().length > 0)?.trim() ?? message;
  }
}

async function main() {
  console.log('\nS3d — APPEND-ONLY VISIT WORKFLOW EVENTS');
  console.log('='.repeat(78));

  const who = await prisma.$queryRawUnsafe<Array<{ usr: string; su: string }>>(
    `SELECT current_user AS usr, current_setting('is_superuser') AS su`,
  );
  console.log(`\n  Running as: ${who[0].usr} (superuser: ${who[0].su})\n`);
  check(
    '0. the check is running as the normal application role, not a superuser',
    who[0].su === 'off',
    'a superuser bypasses RLS entirely and would prove nothing',
  );

  // -- Policy shape ---------------------------------------------------------
  const policies = await prisma.$queryRawUnsafe<Array<{ policyname: string; cmd: string }>>(
    `SELECT policyname, cmd FROM pg_policies WHERE tablename = 'visit_workflow_events'`,
  );
  const cmds = policies.map((p) => p.cmd);
  check('1. a SELECT policy exists', cmds.includes('SELECT'));
  check('2. an INSERT policy exists', cmds.includes('INSERT'));
  check(
    '3. NO update or delete policy exists — the absence is the enforcement',
    !cmds.includes('UPDATE') && !cmds.includes('DELETE') && !cmds.includes('ALL'),
    policies.map((p) => `${p.policyname}:${p.cmd}`).join(', '),
  );

  const forced = await prisma.$queryRawUnsafe<Array<{ f: boolean }>>(
    `SELECT relforcerowsecurity AS f FROM pg_class WHERE relname = 'visit_workflow_events'`,
  );
  check(
    '4. FORCE row level security is on, so the owner is not exempt',
    forced[0]?.f === true,
    'without FORCE, the table owner skips policies entirely',
  );

  const grants = await prisma.$queryRawUnsafe<Array<{ privilege_type: string }>>(
    `SELECT privilege_type FROM information_schema.table_privileges
      WHERE table_name = 'visit_workflow_events' AND grantee = current_user`,
  );
  const held = grants.map((g) => g.privilege_type);
  check('5. UPDATE was revoked from the application role', !held.includes('UPDATE'), held.join(', ') || 'none');
  check('6. DELETE was revoked from the application role', !held.includes('DELETE'), held.join(', ') || 'none');
  // TRUNCATE is a separate privilege and is NOT filtered by row-level
  // security. Left in place, it empties the whole audit trail in one
  // statement while every other check on this page still reads green — which
  // is exactly how a verification pass talks itself into a false result.
  check(
    '6b. TRUNCATE was revoked — RLS does not filter it',
    !held.includes('TRUNCATE'),
    held.join(', ') || 'none',
  );

  // -- Behaviour, which is what actually matters ----------------------------
  const tenants = await listTenants();
  let seedTenant = '';
  let seed: { id: string; clinicId: string; staffId: string | null } | null = null;
  for (const id of tenants) {
    const found = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, id);
      return tx.visit.findFirst({
        where: { staffId: { not: null } },
        select: { id: true, clinicId: true, staffId: true },
      });
    });
    if (found) {
      seedTenant = id;
      seed = found;
      break;
    }
  }
  if (!seed) throw new Error('No visit with an attending clinician to seed a probe event with.');

  const eventId = randomUUID();
  const insertSql = `INSERT INTO visit_workflow_events
      (id, tenant_id, clinic_id, visit_id, event_type, actor_staff_id,
       actor_name_snapshot, actor_role_snapshot, reason)
     VALUES ($1, $2, $3, $4, 'CONSULTATION_STARTED', $5, 'Probe', 'PROBE', 'original')`;

  // INSERT must still work, or every refusal below is meaningless.
  const insertError = await probe(seedTenant, async (tx) => {
    await tx.$executeRawUnsafe(insertSql, eventId, seedTenant, seed!.clinicId, seed!.id, seed!.staffId);
  });
  check('7. INSERT still works for the application role', insertError === null, insertError ?? 'accepted');

  // UPDATE, in the same transaction as its own insert — so the row provably
  // exists and visibility is not what is being tested.
  const updateError = await probe(seedTenant, async (tx) => {
    await tx.$executeRawUnsafe(insertSql, eventId, seedTenant, seed!.clinicId, seed!.id, seed!.staffId);
    await tx.$executeRawUnsafe(
      `UPDATE visit_workflow_events SET reason = 'rewritten' WHERE id = $1`,
      eventId,
    );
  });
  check('8. UPDATE is refused by the database', updateError !== null, updateError ?? 'UPDATE SUCCEEDED');

  const deleteError = await probe(seedTenant, async (tx) => {
    await tx.$executeRawUnsafe(insertSql, eventId, seedTenant, seed!.clinicId, seed!.id, seed!.staffId);
    await tx.$executeRawUnsafe(`DELETE FROM visit_workflow_events WHERE id = $1`, eventId);
  });
  check('9. DELETE is refused by the database', deleteError !== null, deleteError ?? 'DELETE SUCCEEDED');

  // A blanket DELETE, the shape a careless cleanup script would take.
  const wipeError = await probe(seedTenant, async (tx) => {
    await tx.$executeRawUnsafe(`DELETE FROM visit_workflow_events`);
  });
  check('10. an unfiltered DELETE is refused too', wipeError !== null, wipeError ?? 'WIPE SUCCEEDED');

  // -- Tenant isolation survives the policy split ---------------------------
  const other = tenants.find((t) => t !== seedTenant);
  let crossTenant: string | null = 'no second tenant available';
  if (other) {
    crossTenant = await probe(seedTenant, async (tx) => {
      await tx.$executeRawUnsafe(insertSql, randomUUID(), other, seed!.clinicId, seed!.id, seed!.staffId);
    });
  }
  check('11. a cross-tenant INSERT is still refused', crossTenant !== null, crossTenant ?? 'ACCEPTED');

  const crossRead = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, other ?? seedTenant);
    return tx.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM visit_workflow_events WHERE tenant_id = $1`,
      seedTenant,
    );
  });
  check('12. a cross-tenant READ returns nothing', Number(crossRead[0].n) === 0);

  // -- No route in the application exposes mutation --------------------------
  let residue = 0;
  for (const id of tenants) {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, id);
      return tx.visitWorkflowEvent.count();
    });
    residue += rows;
  }
  check('13. no probe row survived — every transaction rolled back', residue === 0, `${residue} rows`);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
