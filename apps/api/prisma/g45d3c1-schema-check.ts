import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

config({ path: join(__dirname, '..', '.env') });

// G4.5d3c-1 (D-080) — schema, migration and data-contract verification.
//
// This is a MIGRATION check, not a feature check: there is no doctor-completion
// endpoint yet, by instruction. What it proves is that the additive change did
// not disturb anything that already existed, and that the new table cannot be
// used to write a row that lies about its tenant.
//
//   npx tsx prisma/g45d3c1-schema-check.ts
//
// D-048 NOTE. `visits`, `staff`, `patients` and friends are FORCE ROW LEVEL
// SECURITY with policies keyed on app.tenant_id ALONE — the bypass GUC does
// not cover them. A query run without setting app.tenant_id returns zero rows
// silently and a follow-up check run the same blind way CONFIRMS the false
// result. Every tenant-scoped read below therefore sets the GUC first.
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

/** Runs `fn` with app.tenant_id set, inside a transaction. */
async function asTenant<T>(tenantId: string, fn: (tx: any) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantId);
    return fn(tx);
  });
}

/**
 * The tenant list itself needs the OTHER guc. `tenants` is FORCE RLS with
 * `id = app.tenant_id OR app.bypass_tenant_scope = 'true'`, so a plain
 * `SELECT * FROM tenants` returns zero rows and no error — which is how a
 * check of this shape ends up proving the wrong thing (D-048).
 */
async function listTenants(): Promise<string[]> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.bypass_tenant_scope', 'true', true)`);
    const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM tenants`);
    return rows.map((r) => r.id);
  });
}

async function main() {
  console.log('\nG4.5d3c-1 — DOCTOR-COMPLETION SCHEMA AND WORKFLOW EVENTS');
  console.log('='.repeat(78));

  // Pick a tenant that actually has visits, so "readable" means something.
  //
  // D-048 IN PRACTICE: `SELECT tenant_id, count(*) FROM visits GROUP BY 1` run
  // here returns ZERO ROWS, because the session has no app.tenant_id and the
  // policy on `visits` keys on that alone. It raises no error. The tenant list
  // therefore comes from `tenants`, and every count is taken with the GUC set.
  const allTenants = await listTenants();
  if (allTenants.length === 0) {
    throw new Error('No tenants visible even with the bypass GUC — check the connection, not the schema.');
  }
  const counted: Array<{ id: string; visits: number }> = [];
  for (const id of allTenants) {
    counted.push({ id, visits: await asTenant(id, (tx) => tx.visit.count()) });
  }
  counted.sort((a, b) => b.visits - a.visits);
  const busiest = counted[0];
  if (!busiest || busiest.visits === 0) {
    throw new Error('No visits in the database — this check needs existing rows to prove nothing broke.');
  }
  const tenantId = busiest.id;
  console.log(
    `\n  Tenants: ${allTenants.length}. Under test: ${tenantId} (${busiest.visits} visits)\n`,
  );

  // -- 1-3, 14: existing rows still read ------------------------------------
  const existing = await asTenant(tenantId, async (tx) => ({
    visits: await tx.visit.count(),
    tickets: await tx.queueTicket.count(),
    legacy: await tx.queueTicket.count({ where: { status: 'DISPENSARY_PAYMENT' } }),
    withHistory: await tx.visit.count({ where: { checkOutAt: { not: null } } }),
    sample: await tx.visit.findFirst({
      include: { patient: true, staff: true, queueTicket: true, invoices: true, diagnoses: true },
    }),
  }));

  check('1. existing Visit rows remain readable', existing.visits > 0, `${existing.visits} rows`);
  check('2. existing QueueTicket rows remain readable', existing.tickets > 0, `${existing.tickets} rows`);
  check(
    '3. existing DISPENSARY_PAYMENT rows remain valid',
    existing.legacy >= 0,
    `${existing.legacy} legacy rows, all still queryable by that status`,
  );
  check(
    '14. existing Visit history remains readable',
    existing.sample !== null && existing.sample.patient !== null,
    `checked-out visits: ${existing.withHistory}`,
  );

  // -- 4: the new statuses exist --------------------------------------------
  const statuses = await prisma.$queryRawUnsafe<Array<{ enumlabel: string }>>(
    `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'QueueTicketStatus' ORDER BY e.enumsortorder`,
  );
  const labels = statuses.map((s) => s.enumlabel);
  const added = ['AT_PROCEDURE', 'READY_FOR_DISPENSARY', 'READY_FOR_PAYMENT'];
  const kept = ['WAITING', 'IN_CONSULTATION', 'DISPENSARY_PAYMENT', 'COMPLETED', 'CANCELLED'];
  check('4. new QueueTicket statuses migrated', added.every((s) => labels.includes(s)), labels.join(', '));
  check('4b. every existing status is retained', kept.every((s) => labels.includes(s)));

  const destinations = await prisma.$queryRawUnsafe<Array<{ enumlabel: string }>>(
    `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'DoctorCompletionDestination'`,
  );
  check(
    '4c. DoctorCompletionDestination is exactly DISPENSARY / PAYMENT / NONE',
    destinations.length === 3 &&
      ['DISPENSARY', 'PAYMENT', 'NONE'].every((d) => destinations.some((x) => x.enumlabel === d)),
    destinations.map((d) => d.enumlabel).join(', '),
  );

  // -- 5-7: nothing was backfilled ------------------------------------------
  //
  // Counted PER TENANT with the GUC set. Run blind, this query returns 0/0/0
  // and would "prove" the absence of backfill by seeing no rows at all —
  // the exact shape of a check that confirms its own false result (D-048).
  const fabricated = { at: 0, by: 0, dest: 0 };
  let visitsScanned = 0;
  for (const t of counted) {
    const [row] = await asTenant(t.id, (tx) =>
      tx.$queryRawUnsafe<Array<{ at: bigint; by: bigint; dest: bigint; n: bigint }>>(
        `SELECT count(*) FILTER (WHERE doctor_completed_at IS NOT NULL)          AS at,
                count(*) FILTER (WHERE doctor_completed_by_staff_id IS NOT NULL) AS by,
                count(*) FILTER (WHERE doctor_completed_destination IS NOT NULL) AS dest,
                count(*) AS n
         FROM visits`,
      ),
    );
    fabricated.at += Number(row.at);
    fabricated.by += Number(row.by);
    fabricated.dest += Number(row.dest);
    visitsScanned += Number(row.n);
  }
  const scanned = `across ${visitsScanned} visits in ${counted.length} tenants`;
  check('5. no existing Visit received doctorCompletedAt', fabricated.at === 0, scanned);
  check('6. no existing Visit received doctorCompletedByStaffId', fabricated.by === 0, scanned);
  check('7. no existing Visit received doctorCompletedDestination', fabricated.dest === 0, scanned);
  check(
    '5b. the scan actually saw the rows it claims to have checked',
    visitsScanned > 0,
    'guards against a blind read reporting zero for the wrong reason',
  );

  // -- 8: one ticket per visit ----------------------------------------------
  const unique = await prisma.$queryRawUnsafe<Array<{ indexdef: string }>>(
    `SELECT indexdef FROM pg_indexes WHERE tablename = 'queue_tickets' AND indexdef ILIKE '%UNIQUE%visit_id%'`,
  );
  check('8. QueueTicket.visitId remains UNIQUE', unique.length === 1, unique[0]?.indexdef ?? 'MISSING');

  // -- 9, 10: relationships are enforced by the database, not by hope -------
  const fks = await prisma.$queryRawUnsafe<Array<{ conname: string; ref: string; deltype: string }>>(
    // confdeltype is a "char" — cast it, or the adapter cannot deserialise it.
    `SELECT c.conname, cl.relname AS ref, c.confdeltype::text AS deltype
     FROM pg_constraint c
     JOIN pg_class t  ON t.oid  = c.conrelid
     JOIN pg_class cl ON cl.oid = c.confrelid
     WHERE t.relname = 'visit_workflow_events' AND c.contype = 'f'`,
  );
  const refs = Object.fromEntries(fks.map((f) => [f.ref, f.deltype]));
  check('9. workflow events require a valid tenant', 'tenants' in refs);
  check('10. workflow events require a valid visit', 'visits' in refs);
  check('10b. clinic and actor are equally required', 'clinics' in refs && 'staff' in refs);
  check(
    '10c. history cannot be erased by deleting what it describes',
    refs['visits'] === 'r' && refs['tenants'] === 'r' && refs['staff'] === 'r',
    'ON DELETE RESTRICT on visit, tenant and actor',
  );
  check(
    '10d. losing an operational ticket does not lose the transition',
    refs['queue_tickets'] === 'n',
    'ON DELETE SET NULL on queue_ticket_id',
  );

  // -- 11: a cross-tenant write is refused by RLS, not by the application ---
  const other = allTenants.filter((id) => id !== tenantId).map((id) => ({ id }));
  const seed = await asTenant(tenantId, async (tx) => {
    const v = await tx.visit.findFirst({ select: { id: true, clinicId: true, staffId: true } });
    return v;
  });

  let crossTenantRefused = false;
  let crossTenantDetail = 'no second tenant available to test with';
  if (other[0] && seed) {
    try {
      await prisma.$transaction(async (tx) => {
        // Session belongs to `tenantId`; the row claims the OTHER tenant.
        await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantId);
        await tx.$executeRawUnsafe(
          `INSERT INTO visit_workflow_events
             (id, tenant_id, clinic_id, visit_id, event_type,
              actor_staff_id, actor_name_snapshot, actor_role_snapshot)
           VALUES ($1, $2, $3, $4, 'CONSULTATION_STARTED', $5, 'Probe', 'PROBE')`,
          randomUUID(),
          other[0].id,
          seed.clinicId,
          seed.id,
          seed.staffId,
        );
        throw new Error('__rollback__');
      });
    } catch (e) {
      const message = (e as Error).message;
      crossTenantRefused = !message.includes('__rollback__');
      const firstUseful = message.split('\n').find((l) => l.trim().length > 0) ?? '';
      crossTenantRefused = !message.includes('__rollback__');
      crossTenantDetail = crossTenantRefused
        ? `refused by the database: ${firstUseful.trim().slice(0, 80)}`
        : 'INSERT SUCCEEDED — the WITH CHECK policy is not doing its job';
    }
  }
  check('11. cross-tenant workflow-event references are denied', crossTenantRefused, crossTenantDetail);

  // A same-tenant write must still work, or check 11 proves nothing.
  let sameTenantWorks = false;
  if (seed) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantId);
        await tx.$executeRawUnsafe(
          `INSERT INTO visit_workflow_events
             (id, tenant_id, clinic_id, visit_id, event_type, previous_status, new_status,
              actor_staff_id, actor_name_snapshot, actor_role_snapshot)
           VALUES ($1, $2, $3, $4, 'SENT_TO_PROCEDURE', 'IN_CONSULTATION', 'AT_PROCEDURE', $5, 'Probe', 'PROBE')`,
          randomUUID(),
          tenantId,
          seed.clinicId,
          seed.id,
          seed.staffId,
        );
        sameTenantWorks = true;
        throw new Error('__rollback__'); // never leave a probe row behind
      });
    } catch (e) {
      if (!(e as Error).message.includes('__rollback__')) {
        sameTenantWorks = false;
        console.log(`        (same-tenant insert failed: ${(e as Error).message.split('\n')[0]})`);
      }
    }
  }
  check(
    '11b. a valid same-tenant event IS accepted, using a new status',
    sameTenantWorks,
    'IN_CONSULTATION -> AT_PROCEDURE, rolled back',
  );

  // Read WITHOUT the tenant GUC would return zero for the wrong reason
  // (D-048) and cheerfully report a clean table, so this counts per tenant.
  let residue = 0;
  for (const t of counted) {
    residue += await asTenant(t.id, (tx) => tx.visitWorkflowEvent.count());
  }
  check('11c. no probe row was left behind', residue === 0, `${residue} rows across every tenant`);

  // -- 12, 13: the queries the app already runs still compile ---------------
  const compiled = await asTenant(tenantId, async (tx) => {
    // The Queue screen's read.
    const queue = await tx.queueTicket.findMany({
      where: { status: 'WAITING' },
      include: { visit: { include: { patient: true, staff: true } }, room: true },
      take: 3,
    });
    // The Canvas read, including the new fields.
    const canvas = await tx.visit.findFirst({
      include: {
        patient: true,
        staff: true,
        doctorCompletedByStaff: true,
        workflowEvents: true,
        clinicalNotes: true,
        observations: true,
        diagnoses: true,
        prescriptions: true,
        orderServices: true,
        documents: true,
        invoices: true,
        attachments: true,
      },
    });
    return { queue: Array.isArray(queue), canvas: canvas !== null };
  });
  check('12. existing Queue queries compile and run', compiled.queue);
  check('13. existing Canvas queries compile and run, including the new relations', compiled.canvas);

  // -- 19, 20: what the migration file itself does and does not do ----------
  const sql = readFileSync(
    join(__dirname, 'migrations', '20260803190000_doctor_completion_and_workflow_events', 'migration.sql'),
    'utf8',
  );
  check(
    '19. rollback limitations are documented in the migration',
    // The prose wraps across comment lines, so match the phrase, not the line.
    /ROLLBACK LIMITATION/.test(sql) && /cannot DROP a value/i.test(sql),
  );
  const writesData = /^\s*(INSERT INTO|UPDATE)\s/im.test(sql.replace(/--.*$/gm, ''));
  check(
    '20. the migration contains no fixture and no historical rewrite',
    !writesData,
    writesData ? 'found an INSERT or UPDATE' : 'DDL only',
  );
  check(
    '20b. the migration does not touch queue_tickets.visit_id uniqueness',
    !/DROP\s+(INDEX|CONSTRAINT).*visit_id/i.test(sql),
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
