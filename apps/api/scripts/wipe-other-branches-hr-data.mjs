// ONE-OFF: WIPE HR & PAYROLL TEST DATA IN EVERY BRANCH EXCEPT ONE, ON STAGING.
//
// Agreed with the clinic owner (UAT, 11 October 2026), word for word:
//   "Staging only. Wipe HR & payroll TEST data in every branch EXCEPT "KLINIK
//   HIJRAA BANGI" (e.g. BANDING, Contoh Bandar, Contoh Central), so only
//   Hijraa Bangi has HR/payroll data. Remove, for those branches only:
//   employees and everything attached (statutory standings, EPF basis,
//   recurring and carried items, leave, claims, medical benefits, bank
//   details, TP1/TP3), all payroll runs (approved or draft) with payslips,
//   listings, transfers, filing records and acknowledgements, including
//   tenant-wide runs that only contain those branches' staff. Keep: the
//   branches themselves, all clinical/patient/queue/stock/finance data, every
//   employer record, payroll items, pay rules, statutory tables, and
//   everything in KLINIK HIJRAA BANGI (its Jan 2026 draft must stay
//   untouched). Same method as the Hijraa wipe: one-off logged admin script,
//   count first, report counts after. If anything outside this scope would be
//   touched, or if a seed or test depends on this data, stop and ask me."
//
// HOW IT KEEPS TO THAT. The method of scripts/wipe-hijraa-bangi-test-data.mjs:
//   * What is attached is asked of the database: every foreign key pointing
//     at a row being removed is followed. A row of an employee's own HR record
//     goes with them; a row anywhere else that points at what is removed
//     STOPS the script. Nothing is nulled.
//   * A PERSON IS REMOVED ONLY WHEN NOTHING OUTSIDE HR POINTS AT THEM. An
//     employee whose staff account is used elsewhere (a visit, an appointment,
//     an invoice, an audit, another branch's record) keeps the account and
//     loses only the HR record: profile, salary, standings, EPF basis, items,
//     leave, claims, benefits, files, TP1/TP3, year to date, payslip rows. An
//     owner/admin account is never removed. The dry run lists who is which.
//   * The branch kept is fingerprinted before and after (its runs, payslip
//     lines and employee records); any difference rolls everything back.
//   * A dry run is the default and is READ ONLY. WIPE_APPLY=true deletes, in
//     ONE transaction, only when the dry-run verdict is clean.
//   * The approval lock is not weakened: an approved or paid run goes to
//     CANCELLED first; the two delete-refusing triggers are switched off
//     inside this transaction only and on again before it commits.
//   * Logged: counts to the job log and one audit_logs row. No personal data
//     printed: counts, ids, roles, employee numbers and branch names only.
//   * One tenant: the one holding the branch kept. Branches in any other
//     tenant are counted and reported, never changed.
//
// Environment: DATABASE_URL (the OWNER connection: every table is FORCE ROW
// LEVEL SECURITY), WIPE_APPLY=true to delete. WIPE_KEEP_BRANCH exists for the
// local rehearsal only.
import pg from 'pg';

const norm = (text) => (text ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
const APPLY = process.env.WIPE_APPLY === 'true';
const KEEP = norm(process.env.WIPE_KEEP_BRANCH ?? 'KLINIK HIJRAA BANGI');

// An employee's own HR record, and the parts of a payroll run.
const HR_RECORD = new Set([
  'employee_profiles', 'employee_salaries', 'employee_statutory_classifications', 'employee_contribution_bases',
  'employee_tp1_entries', 'employee_tp3_records', 'employee_ytd', 'employee_recurring_items',
  'attendance_records', 'attendance_punches', 'attendance_correction_requests',
  'leave_requests', 'leave_request_attachments', 'leave_balances',
  'staff_claims', 'staff_claim_events', 'staff_claim_attachments', 'locum_sessions', 'incentive_results',
  'staff_benefit_accounts', 'staff_benefit_usages', 'staff_benefit_members',
  'staff_files', 'staff_role_assignments', 'staff_permission_grants', 'staff_notifications', 'staff_professional_audits',
  'user_clinic_access',
  'payroll_input_entries', 'payroll_lines', 'payroll_exceptions', 'payroll_snapshots', 'payroll_run_approvals',
  'payroll_adjustments', 'payroll_payment_batches', 'payroll_payment_lines', 'payroll_statutory_submissions',
  'payroll_warning_acknowledgements', 'payroll_payslip_checks',
]);
// The account, not the employment: kept with a person who keeps their account.
const ACCOUNT = new Set(['staff_role_assignments', 'staff_permission_grants', 'staff_notifications', 'user_clinic_access', 'staff_professional_audits']);
const OWNER_COLUMNS = new Set(['staff_id', 'recipient_staff_id', 'user_id']);
const OWNED_BY = {
  employee_profiles: 'staff_id', employee_salaries: 'staff_id', employee_statutory_classifications: 'staff_id',
  employee_contribution_bases: 'staff_id', employee_tp1_entries: 'staff_id', employee_tp3_records: 'staff_id',
  employee_ytd: 'staff_id', employee_recurring_items: 'staff_id', attendance_records: 'staff_id',
  attendance_punches: 'staff_id', attendance_correction_requests: 'staff_id', leave_requests: 'staff_id',
  leave_balances: 'staff_id', staff_claims: 'staff_id', locum_sessions: 'staff_id', incentive_results: 'staff_id',
  staff_benefit_accounts: 'staff_id', staff_files: 'staff_id', staff_role_assignments: 'staff_id',
  staff_permission_grants: 'staff_id', staff_notifications: 'recipient_staff_id', staff_professional_audits: 'staff_id',
  payroll_input_entries: 'staff_id', payroll_lines: 'staff_id', payroll_payment_lines: 'staff_id',
  payroll_exceptions: 'staff_id', payroll_adjustments: 'staff_id',
};
// The HR record proper, by its owner column: what a person who keeps their
// account still loses.
const PERSONAL = Object.entries(OWNED_BY).filter(([table]) => !ACCOUNT.has(table));
const ORDER = [
  'payroll_payslip_checks', 'payroll_snapshots', 'payroll_exceptions',
  'payroll_payment_lines', 'payroll_payment_batches', 'payroll_statutory_submissions',
  'payroll_warning_acknowledgements',
  'staff_claim_events', 'staff_claim_attachments', 'staff_claims', 'locum_sessions',
  'payroll_run_approvals',
  'payroll_adjustments', 'payroll_lines', 'payroll_runs', 'payroll_input_entries',
  'employee_recurring_items', 'employee_ytd', 'employee_salaries',
  'employee_tp1_entries', 'employee_tp3_records', 'employee_statutory_classifications',
  'employee_contribution_bases',
  'incentive_results',
  'staff_benefit_usages', 'staff_benefit_members', 'staff_benefit_accounts',
  'leave_balances',
  'attendance_punches', 'attendance_correction_requests', 'attendance_records', 'employee_profiles',
  'staff_role_assignments', 'staff_permission_grants',
  'staff_professional_audits', 'leave_request_attachments', 'leave_requests', 'staff_files',
  'staff_notifications',
  'user_clinic_access', 'staff', 'users',
];
const LOCKS = { payroll_snapshots: 'payroll_snapshots_no_update', payroll_adjustments: 'payroll_adjustments_append_only_trigger' };

const say = (line = '') => console.log(line);
const q = (id) => `"${id.replace(/"/g, '""')}"`;
const n = async (sql, params) => Number((await client.query(sql, params)).rows[0].n);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
  await client.connect();
  await client.query('BEGIN');
  if (!APPLY) await client.query('SET TRANSACTION READ ONLY');
  await client.query(`SET LOCAL statement_timeout = '120s'`);
  await client.query(`SET LOCAL lock_timeout = '15s'`);
  say(`Mode: ${APPLY ? 'APPLY (deletes, one transaction)' : 'DRY RUN (read only, changes nothing)'}`);
  say(`Kept: ${KEEP}. In scope: every other branch of its tenant.`);

  // ---- 1. The branch kept, and every tenant. ------------------------------
  await client.query(`SELECT set_config('app.bypass_tenant_scope', 'true', true)`);
  const tenants = (await client.query(`SELECT id, name FROM tenants ORDER BY created_at`)).rows;
  await client.query(`SELECT set_config('app.bypass_tenant_scope', 'false', true)`);
  const setTenant = (id) => client.query(`SELECT set_config('app.tenant_id', $1, true)`, [id]);
  const found = [];
  const census = [];
  for (const tenant of tenants) {
    await setTenant(tenant.id);
    const clinics = (await client.query(`SELECT id, name FROM clinics WHERE tenant_id = $1 ORDER BY name`, [tenant.id])).rows;
    for (const clinic of clinics) if (norm(clinic.name) === KEEP) found.push({ tenantId: tenant.id, clinicId: clinic.id });
    const profiles = await n(`SELECT count(*)::int AS n FROM employee_profiles WHERE tenant_id = $1`, [tenant.id]);
    const runs = await n(`SELECT count(*)::int AS n FROM payroll_runs WHERE tenant_id = $1`, [tenant.id]);
    census.push({ tenant, clinics: clinics.length, profiles, runs });
  }
  say(`\n== 1. Tenants: ${tenants.length}. Branches named ${KEEP}: ${found.length}.`);
  if (found.length !== 1) return stop(`Expected exactly one branch named ${KEEP}; found ${found.length}. Nothing was changed.`);
  const { tenantId, clinicId: keepId } = found[0];
  for (const row of census) {
    const mark = row.tenant.id === tenantId ? 'THIS TENANT' : 'other tenant, not touched';
    say(`  - ${row.tenant.name} (${row.tenant.id}) · ${row.clinics} branch(es) · ${row.profiles} employee record(s) · ${row.runs} payroll run(s) · ${mark}`);
  }
  await setTenant(tenantId);

  // ---- 2. The branches. ---------------------------------------------------
  const clinics = (
    await client.query(
      `SELECT c.id, c.name,
              (SELECT count(*)::int FROM staff s JOIN employee_profiles p ON p.staff_id = s.id WHERE s.clinic_id = c.id) AS employees,
              (SELECT count(*)::int FROM payroll_runs r WHERE r.clinic_id = c.id) AS runs
         FROM clinics c WHERE c.tenant_id = $1 ORDER BY c.name`,
      [tenantId],
    )
  ).rows;
  const scopeClinics = clinics.filter((clinic) => clinic.id !== keepId);
  const scopeIds = scopeClinics.map((clinic) => clinic.id);
  const nameOf = new Map(clinics.map((clinic) => [clinic.id, clinic.name]));
  say(`\n== 2. Branches of this tenant`);
  for (const clinic of clinics) {
    say(`  - ${clinic.id === keepId ? 'KEEP  ' : 'WIPE  '} ${clinic.name} · ${clinic.employees} employee record(s) · ${clinic.runs} payroll run(s)`);
  }
  const noBranch = await n(
    `SELECT count(*)::int AS n FROM staff s JOIN employee_profiles p ON p.staff_id = s.id WHERE s.tenant_id = $1 AND s.clinic_id IS NULL`,
    [tenantId],
  );
  if (noBranch > 0) say(`  NOTE: ${noBranch} employee record(s) belong to staff with no branch. Not in any branch named: kept.`);

  // ---- 3. The people of those branches with any HR record. ----------------
  const personalUnion = PERSONAL.map(([table, col]) => `SELECT ${q(col)}::text AS sid FROM ${q(table)} WHERE tenant_id = $2`).join(' UNION ');
  const people = (
    await client.query(
      `SELECT s.id, s.role::text AS role, s.user_id, s.clinic_id, p.employee_no, p.employment_status::text AS status,
              EXISTS (SELECT 1 FROM staff_role_assignments a WHERE a.staff_id = s.id AND a.role::text = 'OWNER_ADMIN') AS owner_assigned
         FROM staff s LEFT JOIN employee_profiles p ON p.staff_id = s.id
        WHERE s.tenant_id = $2 AND s.clinic_id = ANY($1::text[]) AND s.id IN (${personalUnion})
        ORDER BY s.clinic_id, p.employee_no NULLS LAST, s.created_at`,
      [scopeIds, tenantId],
    )
  ).rows;
  const targets = people.map((person) => person.id);
  const keptEmployees = await n(
    `SELECT count(*)::int AS n FROM staff s JOIN employee_profiles p ON p.staff_id = s.id WHERE s.clinic_id = $1`,
    [keepId],
  );
  say(`\n== 3. People with an HR record in the branches wiped: ${people.length}. Employee records in ${KEEP} (kept): ${keptEmployees}.`);
  if (people.length === 0) say('  Nobody.');

  // ---- 4. Payroll runs. ---------------------------------------------------
  const runs = (
    await client.query(
      `SELECT r.id, to_char(r.period, 'YYYY-MM') AS period, r.status::text AS status, r.run_type::text AS run_type, r.clinic_id,
              (SELECT count(*)::int FROM payroll_lines l WHERE l.payroll_run_id = r.id) AS lines,
              (SELECT count(*)::int FROM payroll_lines l WHERE l.payroll_run_id = r.id AND l.staff_id = ANY($2::text[])) AS theirs
         FROM payroll_runs r
        WHERE r.tenant_id = $3 AND (r.clinic_id = ANY($1::text[]) OR r.clinic_id IS NULL)
        ORDER BY r.clinic_id NULLS FIRST, r.period, r.sequence`,
      [scopeIds, targets, tenantId],
    )
  ).rows;
  const problems = [];
  const scopeRuns = [];
  say(`\n== 4. Payroll runs of the branches wiped, and runs for the whole tenant`);
  for (const run of runs) {
    const others = run.lines - run.theirs;
    const where = run.clinic_id ? nameOf.get(run.clinic_id) : 'whole tenant';
    if (run.clinic_id === null && others > 0) {
      if (run.theirs > 0) problems.push(`The ${run.period} ${run.status} run for the whole tenant (${run.id}) pays ${run.theirs} of the people wiped and ${others} others.`);
      say(`  kept: ${run.period} · ${run.status} · ${where} · ${run.lines} line(s), ${others} of people outside the branches wiped`);
      continue;
    }
    if (others > 0) problems.push(`The ${run.period} ${run.status} run of ${where} (${run.id}) carries ${others} line(s) of people outside the branches wiped.`);
    scopeRuns.push(run.id);
    say(`  - ${run.period} · ${run.status} · ${run.run_type} · ${where} · ${run.lines} payslip line(s)${run.lines === 0 && !run.clinic_id ? ' · empty' : ''}`);
  }
  if (scopeRuns.length === 0) say('  None.');

  // ---- 5. Everything attached, asked of the database. ---------------------
  const fks = (
    await client.query(
      `SELECT child.relname AS child, ccol.attname AS child_col, parent.relname AS parent, pcol.attname AS parent_col,
              con.confdeltype AS on_delete, cardinality(con.conkey) AS width
         FROM pg_constraint con
         JOIN pg_class child ON child.oid = con.conrelid
         JOIN pg_class parent ON parent.oid = con.confrelid
         JOIN pg_namespace pn ON pn.oid = parent.relnamespace AND pn.nspname = 'public'
         JOIN pg_attribute ccol ON ccol.attrelid = con.conrelid AND ccol.attnum = con.conkey[1]
         JOIN pg_attribute pcol ON pcol.attrelid = con.confrelid AND pcol.attnum = con.confkey[1]
        WHERE con.contype = 'f'`,
    )
  ).rows;
  const colsOf = async (name) =>
    new Set(
      (await client.query(`SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = $1`, [name])).rows.map(
        (row) => row.table_name,
      ),
    );
  const hasTenant = await colsOf('tenant_id');
  const hasId = await colsOf('id');
  const inTenant = (table, i) => (hasTenant.has(table) ? ` AND tenant_id = $${i}` : '');
  const withTenant = (table, params) => (hasTenant.has(table) ? [...params, tenantId] : params);
  const owns = (fk) =>
    HR_RECORD.has(fk.child) &&
    (fk.parent === 'staff' || fk.parent === 'users'
      ? OWNER_COLUMNS.has(fk.child_col)
      : fk.parent === 'payroll_runs'
        ? fk.child_col === 'payroll_run_id'
        : HR_RECORD.has(fk.parent));

  const userOf = new Map(people.map((person) => [person.id, person.user_id]));
  // Never an owner/admin account; otherwise everybody starts as removed whole.
  const keepAccount = new Map(
    people.filter((person) => person.role === 'OWNER_ADMIN' || person.owner_assigned).map((person) => [person.id, ['owner/admin account']]),
  );

  const buildPlan = async () => {
    const whole = targets.filter((id) => !keepAccount.has(id));
    const recordOnly = targets.filter((id) => keepAccount.has(id));
    const plan = new Map([
      ['staff', new Set(whole)],
      ['users', new Set(whole.map((id) => userOf.get(id)).filter(Boolean))],
      ['payroll_runs', new Set(scopeRuns)],
    ]);
    const add = (table, ids) => {
      if (!ids.length) return false;
      const set = plan.get(table) ?? new Set();
      const size = set.size;
      for (const id of ids) set.add(id);
      plan.set(table, set);
      return set.size > size;
    };
    if (recordOnly.length) {
      for (const [table, col] of PERSONAL) {
        const rows = (await client.query(`SELECT id FROM ${q(table)} WHERE ${q(col)} = ANY($1::text[])${inTenant(table, 2)}`, withTenant(table, [recordOnly]))).rows;
        add(table, rows.map((row) => row.id));
      }
    }
    const valuesOf = async (table, column) => {
      const ids = [...(plan.get(table) ?? [])];
      if (ids.length === 0) return [];
      if (column === 'id') return ids;
      return (await client.query(`SELECT DISTINCT ${q(column)}::text AS v FROM ${q(table)} WHERE id = ANY($1::text[])`, [ids])).rows
        .map((row) => row.v)
        .filter((value) => value !== null);
    };
    for (let grew = true; grew; ) {
      grew = false;
      for (const fk of fks.filter((edge) => plan.has(edge.parent) && owns(edge))) {
        if (!hasId.has(fk.child) || fk.width !== 1) {
          problems.push(`${fk.child}.${fk.child_col} has no single id to remove by; handle it by hand.`);
          continue;
        }
        const values = await valuesOf(fk.parent, fk.parent_col);
        if (values.length === 0) continue;
        const rows = (
          await client.query(`SELECT id FROM ${q(fk.child)} WHERE ${q(fk.child_col)}::text = ANY($1::text[])${inTenant(fk.child, 2)}`, withTenant(fk.child, [values]))
        ).rows;
        if (add(fk.child, rows.map((row) => row.id))) grew = true;
      }
    }
    // Acknowledgements keyed by what they acknowledge rather than by a key.
    const subjects = [...(plan.get('employee_contribution_bases') ?? []), ...targets, ...scopeRuns];
    if (subjects.length) {
      const acks = (await client.query(`SELECT id FROM payroll_warning_acknowledgements WHERE tenant_id = $2 AND subject_id = ANY($1::text[])`, [subjects, tenantId])).rows;
      add('payroll_warning_acknowledgements', acks.map((row) => row.id));
    }
    return { plan, valuesOf };
  };

  // Who keeps their account: anybody something outside the plan points at.
  let plan;
  let valuesOf;
  for (let changed = true; changed; ) {
    changed = false;
    ({ plan, valuesOf } = await buildPlan());
    for (const fk of fks.filter((edge) => (edge.parent === 'staff' || edge.parent === 'users') && edge.parent_col === 'id')) {
      const removed = [...(plan.get(fk.parent) ?? [])];
      if (removed.length === 0) continue;
      const planned = [...(plan.get(fk.child) ?? [])];
      const sql = hasId.has(fk.child)
        ? `SELECT DISTINCT ${q(fk.child_col)}::text AS v FROM ${q(fk.child)} WHERE ${q(fk.child_col)}::text = ANY($1::text[]) AND NOT (id::text = ANY($2::text[]))`
        : `SELECT DISTINCT ${q(fk.child_col)}::text AS v FROM ${q(fk.child)} WHERE ${q(fk.child_col)}::text = ANY($1::text[])`;
      const hits = (await client.query(sql, hasId.has(fk.child) ? [removed, planned] : [removed])).rows.map((row) => row.v);
      for (const hit of hits) {
        const staffId = fk.parent === 'staff' ? hit : targets.find((id) => userOf.get(id) === hit);
        if (!staffId) continue;
        const reasons = keepAccount.get(staffId) ?? [];
        if (!keepAccount.has(staffId)) changed = true;
        reasons.push(`${fk.child}.${fk.child_col}`);
        keepAccount.set(staffId, reasons);
      }
    }
  }

  // Anything else that points at what is removed: STOP.
  for (const fk of fks.filter((edge) => plan.has(edge.parent))) {
    const values = await valuesOf(fk.parent, fk.parent_col);
    if (values.length === 0) continue;
    const planned = [...(plan.get(fk.child) ?? [])];
    const sql = hasId.has(fk.child)
      ? `SELECT count(*)::int AS n FROM ${q(fk.child)} WHERE ${q(fk.child_col)}::text = ANY($1::text[]) AND NOT (id::text = ANY($2::text[]))`
      : `SELECT count(*)::int AS n FROM ${q(fk.child)} WHERE ${q(fk.child_col)}::text = ANY($1::text[])`;
    const hits = await n(sql, hasId.has(fk.child) ? [values, planned] : [values]);
    if (hits > 0) {
      const effect = { a: 'refuses the delete', r: 'refuses the delete', c: 'would be deleted with it', n: 'would be cleared to empty', d: 'would be reset' }[fk.on_delete] ?? fk.on_delete;
      problems.push(`${hits} row(s) of ${fk.child}.${fk.child_col} point at ${fk.parent} being removed, and are outside the agreed scope (${effect}).`);
    }
  }
  // Rows belonging to a run outside the scope, or to somebody outside it.
  for (const [table, ids] of plan) {
    for (const column of fks.filter((edge) => edge.child === table && edge.parent === 'payroll_runs').map((edge) => edge.child_col)) {
      const outside = (
        await client.query(
          `SELECT to_char(r.period, 'YYYY-MM') AS period, r.status::text AS status, r.clinic_id, count(*)::int AS n
             FROM ${q(table)} t JOIN payroll_runs r ON r.id = t.${q(column)}
            WHERE t.id = ANY($1::text[]) AND NOT (t.${q(column)}::text = ANY($2::text[]))
            GROUP BY 1, 2, 3 ORDER BY 1`,
          [[...ids], scopeRuns],
        )
      ).rows;
      for (const row of outside) {
        problems.push(`${row.n} row(s) of ${table} belong to the ${row.period} ${row.status} run of ${row.clinic_id ? nameOf.get(row.clinic_id) : 'the whole tenant'}, which is kept.`);
      }
    }
    const owner = OWNED_BY[table];
    if (owner) {
      const foreign = await n(
        `SELECT count(*)::int AS n FROM ${q(table)} WHERE id = ANY($1::text[]) AND ${q(owner)} IS NOT NULL AND NOT (${q(owner)}::text = ANY($2::text[]))`,
        [[...ids], targets],
      );
      if (foreign > 0) problems.push(`${foreign} row(s) of ${table} belong to somebody outside the branches wiped.`);
    }
  }
  for (const table of plan.keys()) if (!ORDER.includes(table)) problems.push(`${table} has rows to remove but no agreed place in the delete order.`);

  // ---- 6. The plan: who, and counts before. -------------------------------
  say(`\n== 5. People`);
  for (const person of people) {
    const kept = keepAccount.get(person.id);
    say(
      `  - ${kept ? 'HR RECORD ONLY' : 'REMOVE WHOLE   '} ${nameOf.get(person.clinic_id)} · staff ${person.id} · ${person.role} · ${person.status ?? 'no profile'} · employee no ${person.employee_no ?? '-'} · login ${person.user_id ? 'yes' : 'no'}` +
        (kept ? ` · account kept: ${[...new Set(kept)].slice(0, 4).join(', ')}` : ''),
    );
  }
  const before = {};
  for (const table of ORDER) if (plan.get(table)?.size) before[table] = plan.get(table).size;
  say(`\n== 6. To remove (counts before)`);
  for (const [table, count] of Object.entries(before)) say(`  ${table.padEnd(38)} ${String(count).padStart(6)}`);
  say(`  ${'TOTAL'.padEnd(38)} ${String(Object.values(before).reduce((a, b) => a + b, 0)).padStart(6)}`);
  const triggers = (
    await client.query(
      `SELECT c.relname AS tbl, t.tgname AS name FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE NOT t.tgisinternal AND c.relname = ANY($1::text[]) ORDER BY 1, 2`,
      [Object.keys(before)],
    )
  ).rows;
  say(`Triggers on these tables: ${triggers.map((t) => `${t.tbl}.${t.name}`).join(', ') || 'none'}.`);

  // What blocks a payroll item change dated January 2026 today: an approved or
  // paid run of this tenant from that month on (pay-component.service.ts).
  const blocking = (
    await client.query(
      `SELECT r.id, to_char(r.period, 'YYYY-MM') AS period, r.status::text AS status, r.clinic_id FROM payroll_runs r
        WHERE r.tenant_id = $1 AND r.status IN ('APPROVED', 'PAID') AND r.period >= DATE '2026-01-01' ORDER BY r.period`,
      [tenantId],
    )
  ).rows;
  say(`\nApproved or paid runs from Jan 2026 (these block an item change dated Jan 2026): ${blocking.length}, of which removed here: ${blocking.filter((run) => scopeRuns.includes(run.id)).length}.`);
  for (const run of blocking.filter((r) => !scopeRuns.includes(r.id))) {
    say(`  stays: ${run.period} · ${run.status} · ${run.clinic_id ? nameOf.get(run.clinic_id) : 'whole tenant'}`);
  }

  // The branch kept, fingerprinted.
  const fingerprint = async () =>
    (
      await client.query(
        `SELECT
           (SELECT count(*)::int FROM payroll_runs WHERE clinic_id = $1) AS runs,
           (SELECT coalesce(md5(string_agg(md5(r::text), '' ORDER BY r.id)), '') FROM payroll_runs r WHERE r.clinic_id = $1) AS runs_md5,
           (SELECT count(*)::int FROM payroll_lines l JOIN payroll_runs r ON r.id = l.payroll_run_id WHERE r.clinic_id = $1) AS lines,
           (SELECT coalesce(md5(string_agg(md5(l::text), '' ORDER BY l.id)), '') FROM payroll_lines l JOIN payroll_runs r ON r.id = l.payroll_run_id WHERE r.clinic_id = $1) AS lines_md5,
           (SELECT count(*)::int FROM payroll_input_entries e WHERE e.clinic_id = $1 OR e.staff_id IN (SELECT id FROM staff WHERE clinic_id = $1)) AS inputs,
           (SELECT coalesce(md5(string_agg(md5(e::text), '' ORDER BY e.id)), '') FROM payroll_input_entries e WHERE e.clinic_id = $1 OR e.staff_id IN (SELECT id FROM staff WHERE clinic_id = $1)) AS inputs_md5,
           (SELECT coalesce(md5(string_agg(md5(p::text), '' ORDER BY p.id)), '') FROM employee_profiles p JOIN staff s ON s.id = p.staff_id WHERE s.clinic_id = $1) AS profiles_md5,
           (SELECT count(*)::int FROM (${personalUnion}) x WHERE sid IN (SELECT id FROM staff WHERE clinic_id = $1)) AS hr_rows`,
        [keepId, tenantId],
      )
    ).rows[0];
  const keptBefore = await fingerprint();
  const keptRuns = (
    await client.query(`SELECT to_char(period, 'YYYY-MM') AS period, status::text AS status, (SELECT count(*)::int FROM payroll_lines l WHERE l.payroll_run_id = r.id) AS lines FROM payroll_runs r WHERE clinic_id = $1 ORDER BY period`, [keepId])
  ).rows;
  say(`${KEEP}, kept as is: ${keptRuns.map((run) => `${run.period} ${run.status} (${run.lines} lines)`).join(', ') || 'no runs'}; ${keptEmployees} employee record(s).`);

  say(`\n== 7. Out of scope`);
  if (problems.length) {
    for (const problem of [...new Set(problems)]) say(`  STOP: ${problem}`);
    return stop(`${new Set(problems).size} thing(s) outside the agreed scope would be touched. Nothing was changed. Ask the owner.`);
  }
  say('  Nothing outside the agreed scope points at what would be removed.');
  if (!APPLY) {
    await client.query('ROLLBACK');
    say(`\nVERDICT: SAFE TO APPLY. Dry run: nothing was changed.`);
    return 0;
  }

  // ---- 8. Apply, in this one transaction. ---------------------------------
  const cancelled = await client.query(`UPDATE payroll_runs SET status = 'CANCELLED' WHERE id = ANY($1::text[]) AND status IN ('APPROVED', 'PAID')`, [scopeRuns]);
  say(`\n== 8. Applying\nApproved or paid runs cancelled first (the lock's own allowed transition): ${cancelled.rowCount}.`);
  const switchedOff = [];
  for (const [table, trigger] of Object.entries(LOCKS)) {
    if (!before[table] || !triggers.some((t) => t.tbl === table && t.name === trigger)) continue;
    await client.query(`ALTER TABLE ${q(table)} DISABLE TRIGGER ${q(trigger)}`);
    switchedOff.push([table, trigger]);
    say(`Lock ${table}.${trigger} switched off inside this transaction.`);
  }
  for (const table of ORDER) {
    const ids = [...(plan.get(table) ?? [])];
    if (ids.length === 0) continue;
    const result = await client.query(`DELETE FROM ${q(table)} WHERE id = ANY($1::text[])${inTenant(table, 2)}`, withTenant(table, [ids]));
    if (result.rowCount !== ids.length) throw new Error(`${table}: planned ${ids.length}, deleted ${result.rowCount}. Rolled back; nothing was changed.`);
  }
  for (const [table, trigger] of switchedOff) {
    await client.query(`ALTER TABLE ${q(table)} ENABLE TRIGGER ${q(trigger)}`);
    say(`Lock ${table}.${trigger} switched back on.`);
  }

  // ---- 9. Counts after, then the record of it. ----------------------------
  let left = 0;
  for (const [table, set] of plan) left += await n(`SELECT count(*)::int AS n FROM ${q(table)} WHERE id = ANY($1::text[])`, [[...set]]);
  const profilesLeft = await n(`SELECT count(*)::int AS n FROM staff s JOIN employee_profiles p ON p.staff_id = s.id WHERE s.clinic_id = ANY($1::text[])`, [scopeIds]);
  const hrLeft = await n(`SELECT count(*)::int AS n FROM (${personalUnion}) x WHERE sid = ANY($1::text[])`, [targets, tenantId]);
  const runsLeft = await n(`SELECT count(*)::int AS n FROM payroll_runs WHERE clinic_id = ANY($1::text[]) OR id = ANY($2::text[])`, [scopeIds, scopeRuns]);
  const keptAfter = await fingerprint();
  const keptSame = JSON.stringify(keptAfter) === JSON.stringify(keptBefore);
  const blockingAfter = await n(
    `SELECT count(*)::int AS n FROM payroll_runs WHERE tenant_id = $1 AND status IN ('APPROVED', 'PAID') AND period >= DATE '2026-01-01'`,
    [tenantId],
  );
  const locksOn = await n(
    `SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relname = ANY($1::text[]) AND t.tgname = ANY($2::text[]) AND t.tgenabled <> 'D'`,
    [Object.keys(LOCKS), Object.values(LOCKS)],
  );
  const accountsKept = [...keepAccount.keys()].length;
  say(`\n== 9. Counts after`);
  say(`Rows of the plan still present: ${left}.`);
  say(`Employee records in the branches wiped: ${profilesLeft}. HR rows of the people wiped: ${hrLeft}. Their payroll runs: ${runsLeft}.`);
  say(`People removed whole: ${targets.length - accountsKept}. Accounts kept without an HR record: ${accountsKept}.`);
  say(`${KEEP}: ${keptSame ? 'unchanged' : 'CHANGED'} (${keptAfter.runs} run(s), ${keptAfter.lines} payslip line(s), ${keptAfter.inputs} input(s)).`);
  say(`Approved or paid runs from Jan 2026 left in this tenant: ${blockingAfter}. Locks on: ${locksOn} of ${Object.keys(LOCKS).length}.`);
  if (left !== 0 || profilesLeft !== 0 || hrLeft !== 0 || runsLeft !== 0 || !keptSame || locksOn !== Object.keys(LOCKS).length) {
    throw new Error('Not clean after the delete, or the branch kept changed. Rolled back; nothing was changed.');
  }
  await client.query(
    `INSERT INTO audit_logs (id, tenant_id, actor_user_id, action, entity_type, entity_id, before, after, created_at)
     VALUES (gen_random_uuid()::text, $1, NULL, 'admin.otherBranchesHrWiped', 'Clinic', $2, $3::jsonb, $4::jsonb, now())`,
    [
      tenantId,
      keepId,
      JSON.stringify({ removed: before, branches: scopeClinics.map((c) => c.id), people: targets, accountsKept: [...keepAccount.keys()], runs: scopeRuns }),
      JSON.stringify({
        employeeRecordsInBranchesWiped: profilesLeft,
        runsLeft,
        keptBranchUnchanged: keptSame,
        approvedFromJan2026: blockingAfter,
        _reason: 'One-off wipe of HR and payroll test data in every branch except the one kept, agreed with the clinic owner on 11 October 2026.',
        _source: 'scripts/wipe-other-branches-hr-data.mjs',
      }),
    ],
  );
  await client.query('COMMIT');
  say(`\nDONE. Committed. HR and payroll data now only in ${KEEP}; one audit_logs row records it.`);
  return 0;
}

async function stop(reason) {
  await client.query('ROLLBACK').catch(() => {});
  say(`\nVERDICT: STOP. ${reason}`);
  return 2;
}

main()
  .then((code) => client.end().then(() => process.exit(code)))
  .catch(async (error) => {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`\nFAILED, rolled back, nothing was changed: ${error.message}`);
    await client.end().catch(() => {});
    process.exit(1);
  });
