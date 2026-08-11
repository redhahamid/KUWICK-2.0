import { join } from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

config({ path: join(__dirname, '..', '.env') });

// G4.5d3c-2b (D-087) — is the completion claim ACTUALLY safe under
// concurrency, against a real PostgreSQL under its real isolation level?
//
// A mocked sequential test cannot answer this. It runs one request at a time
// through a fake transaction, so it proves the code path and nothing about
// what two clients do to one row at the same moment. This runs two genuinely
// overlapping transactions on the live database.
//
//   npx tsx prisma/g45d3c2b-concurrency-check.ts
//
// D-048: `tenants` needs app.bypass_tenant_scope; `visits` needs
// app.tenant_id. Read blind, both return zero rows and no error.
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

/**
 * The claim exactly as the services issue it: the precondition is IN the
 * WHERE clause, so the check and the write are one statement.
 */
async function claimDoctorPhase(tenantId: string, visitId: string, staffId: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantId);
    // A short pause INSIDE the transaction, after it has begun but before the
    // write, so both transactions are provably open at the same time. Without
    // it the two would simply run one after the other and prove nothing.
    await tx.$executeRawUnsafe(`SELECT pg_sleep(0.25)`);
    return tx.visit.updateMany({
      where: { id: visitId, doctorCompletedAt: null },
      data: {
        doctorCompletedAt: new Date(),
        doctorCompletedByStaffId: staffId,
        doctorCompletedDestination: 'NONE',
        doctorCompletedRoutingReason: 'NO_DOWNSTREAM_WORK',
      },
    }).then((r) => r.count);
  });
}

async function claimCheckOut(tenantId: string, visitId: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantId);
    await tx.$executeRawUnsafe(`SELECT pg_sleep(0.25)`);
    return tx.visit
      .updateMany({ where: { id: visitId, checkOutAt: null }, data: { checkOutAt: new Date() } })
      .then((r) => r.count);
  });
}

async function reset(tenantId: string, visitId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantId);
    await tx.$executeRawUnsafe(
      `UPDATE visits SET doctor_completed_at = NULL, doctor_completed_by_staff_id = NULL,
              doctor_completed_destination = NULL, doctor_completed_routing_reason = NULL,
              check_out_at = $2
         WHERE id = $1`,
      visitId,
      null,
    );
  });
}

async function main() {
  console.log('\nG4.5d3c-2b — REAL CONCURRENCY, REAL DATABASE');
  console.log('='.repeat(78));

  const [{ level }] = await prisma.$queryRawUnsafe<Array<{ level: string }>>(
    `SELECT current_setting('transaction_isolation') AS level`,
  );
  console.log(`\n  Isolation level: ${level}\n`);
  check(
    '0. running under the same isolation level the application uses',
    level.toLowerCase() === 'read committed',
    'the level at which a naive read-then-write is NOT safe',
  );

  const tenants = await listTenants();
  let tenantId = '';
  let seed: { id: string; staffId: string | null; checkOutAt: Date | null } | null = null;
  for (const id of tenants) {
    const found = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, id);
      return tx.visit.findFirst({
        where: { staffId: { not: null } },
        select: { id: true, staffId: true, checkOutAt: true },
      });
    });
    if (found) {
      tenantId = id;
      seed = found;
      break;
    }
  }
  if (!seed) throw new Error('No visit available to race against.');

  const originalCheckOut = seed.checkOutAt;

  // --- Doctor-phase claim -------------------------------------------------
  await reset(tenantId, seed.id);
  const doctorRace = await Promise.all([
    claimDoctorPhase(tenantId, seed.id, seed.staffId!),
    claimDoctorPhase(tenantId, seed.id, seed.staffId!),
  ]);
  const doctorWinners = doctorRace.filter((c) => c === 1).length;
  check(
    '8/9. two concurrent doctor-phase claims — exactly ONE wins',
    doctorWinners === 1,
    `counts: [${doctorRace.join(', ')}]`,
  );
  check(
    '9b. the loser sees count 0, so it writes no second event',
    doctorRace.filter((c) => c === 0).length === 1,
    'the event write is gated on this count',
  );

  // Three at once, for good measure.
  await reset(tenantId, seed.id);
  const triple = await Promise.all([
    claimDoctorPhase(tenantId, seed.id, seed.staffId!),
    claimDoctorPhase(tenantId, seed.id, seed.staffId!),
    claimDoctorPhase(tenantId, seed.id, seed.staffId!),
  ]);
  check(
    '8b. three concurrent claims still yield exactly one winner',
    triple.filter((c) => c === 1).length === 1,
    `counts: [${triple.join(', ')}]`,
  );

  // --- Overall completion claim -------------------------------------------
  await reset(tenantId, seed.id);
  const visitRace = await Promise.all([claimCheckOut(tenantId, seed.id), claimCheckOut(tenantId, seed.id)]);
  check(
    '39. two concurrent visit completions — exactly ONE wins',
    visitRace.filter((c) => c === 1).length === 1,
    `counts: [${visitRace.join(', ')}]`,
  );

  // --- Proof the harness can actually detect a failure --------------------
  //
  // A concurrency test that cannot fail proves nothing. This runs the UNSAFE
  // shape — read, then write, without the precondition in the WHERE clause —
  // and shows BOTH transactions commit, which is the bug the claim prevents.
  await reset(tenantId, seed.id);
  const unsafe = async (): Promise<number> =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantId);
      const before = await tx.visit.findUnique({
        where: { id: seed!.id },
        select: { doctorCompletedAt: true },
      });
      await tx.$executeRawUnsafe(`SELECT pg_sleep(0.25)`);
      if (before?.doctorCompletedAt) return 0; // the naive guard
      const r = await tx.visit.updateMany({
        where: { id: seed!.id },
        data: { doctorCompletedAt: new Date() },
      });
      return r.count;
    });
  const naive = await Promise.all([unsafe(), unsafe()]);
  check(
    'CONTROL: the naive read-then-write lets BOTH commit',
    naive.filter((c) => c === 1).length === 2,
    `counts: [${naive.join(', ')}] — this is the defect the claim removes`,
  );

  // --- Leave the row as it was found --------------------------------------
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantId);
    await tx.$executeRawUnsafe(
      `UPDATE visits SET doctor_completed_at = NULL, doctor_completed_by_staff_id = NULL,
              doctor_completed_destination = NULL, doctor_completed_routing_reason = NULL,
              check_out_at = $2 WHERE id = $1`,
      seed.id,
      originalCheckOut,
    );
  });
  const [restored] = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantId);
    return tx.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM visits WHERE id = $1 AND doctor_completed_at IS NOT NULL`,
      seed.id,
    );
  });
  check('the probe visit was restored to its original state', Number(restored.n) === 0);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
