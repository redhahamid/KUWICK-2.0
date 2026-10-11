// THE GUARD IN FRONT OF "Rebuild the demo tenant" (owner, 11 October 2026):
// "make it refuse to rebuild while KLINIK HIJRAA BANGI has HR or payroll data
// unless I type the branch name to confirm."
//
// Rebuilding runs prisma/seed-admin-uat.ts, which deletes the whole tenant
// "Klinik Contoh (UAT)" (REBUILT_TENANT below). KLINIK HIJRAA BANGI lives in
// that tenant on staging, so a rebuild would take its employees and payroll
// with it. This script is READ ONLY and runs before anything is written:
//   * the branch is in the tenant rebuilt and holds employee records, payroll
//     runs or payroll items, and GUARD_CONFIRM is not the branch name: exit 1;
//   * otherwise (no such branch, an empty one, another tenant, or the name
//     typed): exit 0, saying which.
// Anything it cannot read is a refusal, never a pass.
//
// Environment: DATABASE_URL (the owner: FORCE ROW LEVEL SECURITY),
// GUARD_CONFIRM (what was typed). GUARD_BRANCH exists for the local test only.
import pg from 'pg';

const norm = (text) => (text ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
const BRANCH = norm(process.env.GUARD_BRANCH ?? 'KLINIK HIJRAA BANGI');
const REBUILT_TENANT = 'aaaaaaaa-0000-4000-8000-000000000001';
const confirmed = norm(process.env.GUARD_CONFIRM) === BRANCH;

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await client.connect();
  await client.query('BEGIN');
  await client.query('SET TRANSACTION READ ONLY');
  const present = (await client.query(`SELECT to_regclass('public.clinics') IS NOT NULL AS ok`)).rows[0].ok;
  if (!present) {
    console.log('No clinics table yet: an empty database, nothing to protect.');
    return 0;
  }
  await client.query(`SELECT set_config('app.bypass_tenant_scope', 'true', true)`);
  const branches = (
    await client.query(`SELECT id, tenant_id FROM clinics WHERE upper(regexp_replace(btrim(name), '\\s+', ' ', 'g')) = $1`, [BRANCH])
  ).rows;
  await client.query(`SELECT set_config('app.bypass_tenant_scope', 'false', true)`);
  const inRebuilt = branches.filter((branch) => branch.tenant_id === REBUILT_TENANT);
  if (inRebuilt.length === 0) {
    console.log(`${BRANCH}: ${branches.length ? 'in another tenant, which a rebuild does not touch' : 'not on this database'}. Rebuild allowed.`);
    return 0;
  }
  await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [REBUILT_TENANT]);
  const ids = inRebuilt.map((branch) => branch.id);
  const count = async (sql) => Number((await client.query(sql, [ids])).rows[0].n);
  const employees = await count(`SELECT count(*)::int AS n FROM employee_profiles p JOIN staff s ON s.id = p.staff_id WHERE s.clinic_id = ANY($1::text[])`);
  const runs = await count(`SELECT count(*)::int AS n FROM payroll_runs WHERE clinic_id = ANY($1::text[])`);
  const items = await count(
    `SELECT count(*)::int AS n FROM payroll_input_entries WHERE clinic_id = ANY($1::text[]) OR staff_id IN (SELECT id FROM staff WHERE clinic_id = ANY($1::text[]))`,
  );
  console.log(`${BRANCH} is in "Klinik Contoh (UAT)", the tenant a rebuild deletes: ${employees} employee record(s), ${runs} payroll run(s), ${items} payroll item line(s).`);
  if (employees + runs + items === 0) {
    console.log('It holds no HR or payroll data. Rebuild allowed.');
    return 0;
  }
  if (confirmed) {
    console.log(`::warning::The branch name was typed: the rebuild goes ahead and DELETES all of ${BRANCH}'s HR and payroll data above.`);
    return 0;
  }
  console.log(
    `::error::Refusing to rebuild: it would delete ${BRANCH}'s HR and payroll data above. ` +
      `Untick "Rebuild the demo tenant", or type the branch name exactly (${BRANCH}) in the confirmation box to delete it.`,
  );
  return 1;
}

main()
  .then(async (code) => {
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
    process.exit(code);
  })
  .catch(async (error) => {
    console.log(`::error::Could not check ${BRANCH} before a rebuild, so refusing: ${error.message}`);
    await client.end().catch(() => {});
    process.exit(1);
  });
