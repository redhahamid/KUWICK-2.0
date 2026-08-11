import { join } from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

config({ path: join(__dirname, '..', '.env') });

// S3c (D-082) — registration and attendance separated, verified against the
// live database.
//
//   npx tsx prisma/s3c-registration-check.ts
//
// D-048: `tenants` needs app.bypass_tenant_scope; `visits` needs
// app.tenant_id. Read blind, both return zero rows and no error, and a check
// written that way confirms its own false result.
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

async function asTenant<T>(tenantId: string, fn: (tx: any) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantId);
    return fn(tx);
  });
}

async function listTenants(): Promise<string[]> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.bypass_tenant_scope', 'true', true)`);
    const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM tenants`);
    return rows.map((r) => r.id);
  });
}

async function main() {
  console.log('\nS3c — VISIT REGISTRATION vs ATTENDING CLINICIAN');
  console.log('='.repeat(78));

  const tenants = await listTenants();
  let total = 0;
  let withAttending = 0;
  let unassigned = 0;
  let registered = 0;

  for (const id of tenants) {
    const row = await asTenant(id, (tx) =>
      tx.$queryRawUnsafe<Array<{ n: bigint; att: bigint; un: bigint; reg: bigint }>>(
        `SELECT count(*) AS n,
                count(*) FILTER (WHERE staff_id IS NOT NULL)               AS att,
                count(*) FILTER (WHERE staff_id IS NULL)                   AS un,
                count(*) FILTER (WHERE registered_by_staff_id IS NOT NULL) AS reg
         FROM visits`,
      ),
    );
    total += Number(row[0].n);
    withAttending += Number(row[0].att);
    unassigned += Number(row[0].un);
    registered += Number(row[0].reg);
  }
  console.log(`\n  ${tenants.length} tenants, ${total} visits\n`);

  check('1. staff_id is now nullable', await columnIsNullable('staff_id'));
  check('2. registered_by_staff_id exists and is nullable', await columnIsNullable('registered_by_staff_id'));

  check(
    '3. NO existing visit was made unassigned by the migration',
    unassigned === 0,
    `${withAttending} of ${total} keep an attending clinician, ${unassigned} unassigned`,
  );
  check(
    '4. registration attribution was NOT fabricated',
    registered === 0,
    `${registered} rows carry a registrar — nothing was copied from staff_id`,
  );
  check('4b. the scan actually saw rows', total > 0, 'guards against a blind read (D-048)');

  // The two relations are distinct FKs to the same table.
  const fks = await prisma.$queryRawUnsafe<Array<{ conname: string; deltype: string }>>(
    `SELECT c.conname, c.confdeltype::text AS deltype
     FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
     WHERE t.relname = 'visits' AND c.contype = 'f'`,
  );
  const names = fks.map((f) => f.conname);
  check(
    '5. attending and registrar are separate foreign keys',
    names.some((n) => n.includes('staff_id_fkey') && !n.includes('registered')) &&
      names.some((n) => n.includes('registered_by_staff_id_fkey')),
    names.filter((n) => n.includes('staff')).join(', '),
  );
  check(
    '5b. removing a staff row clears registration but never blocks it',
    fks.find((f) => f.conname.includes('registered_by_staff_id_fkey'))?.deltype === 'n',
    'ON DELETE SET NULL',
  );

  // The queue question the partial index exists to answer.
  const idx = await prisma.$queryRawUnsafe<Array<{ indexdef: string }>>(
    `SELECT indexdef FROM pg_indexes WHERE tablename = 'visits' AND indexname LIKE '%unassigned%'`,
  );
  check('6. unassigned visits are indexed for the queue', idx.length === 1, idx[0]?.indexdef ?? 'MISSING');

  // A real unassigned visit can be written and read back.
  //
  // The probe needs a tenant that actually HAS a clinic and a patient to hang
  // it on — tenants[0] is whatever order the catalogue returned, and an empty
  // one would make this check silently skip and report a failure that says
  // nothing about the schema.
  let busiest = tenants[0];
  let seed: { clinicId: string; patientId: string } | null = null;
  for (const id of tenants) {
    const found = await asTenant(id, (tx) =>
      tx.visit.findFirst({ select: { clinicId: true, patientId: true } }),
    );
    if (found) {
      busiest = id;
      seed = found;
      break;
    }
  }
  let roundTrip = false;
  if (seed) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, busiest);
        const rows = await tx.$queryRawUnsafe<Array<{ staff_id: string | null }>>(
          `INSERT INTO visits (id, tenant_id, clinic_id, patient_id, staff_id, visit_number,
                               billing_type, check_in_at, created_at, updated_at)
           VALUES (gen_random_uuid()::text, $1, $2, $3, NULL, 'V-PROBE', 'Self-pay', now(), now(), now())
           RETURNING staff_id`,
          busiest,
          seed.clinicId,
          seed.patientId,
        );
        // `== null` deliberately: the adapter may hand back undefined rather
        // than null for a NULL column, and either answer means the same thing
        // — the row was accepted with no attending clinician.
        roundTrip = rows.length === 1 && rows[0].staff_id == null;
        throw new Error('__rollback__'); // never leave a probe visit behind
      });
    } catch (e) {
      if (!(e as Error).message.includes('__rollback__')) {
        console.log(`        (probe insert failed: ${(e as Error).message.split('\n')[0]})`);
        roundTrip = false;
      }
    }
  }
  check('7. a visit with NO attending clinician can be stored', roundTrip, 'inserted and rolled back');

  let residue = 0;
  for (const id of tenants) {
    residue += await asTenant(id, (tx) => tx.visit.count({ where: { visitNumber: 'V-PROBE' } }));
  }
  check('7b. no probe visit was left behind', residue === 0, `${residue} rows`);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

async function columnIsNullable(column: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ is_nullable: string }>>(
    `SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'visits' AND column_name = $1`,
    column,
  );
  return rows[0]?.is_nullable === 'YES';
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
