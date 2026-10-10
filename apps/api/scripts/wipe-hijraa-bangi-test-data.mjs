// ONE-OFF: WIPE THE TEST EMPLOYEES OF ONE BRANCH ON STAGING.
//
// Agreed with the clinic owner (UAT, 10 October 2026), word for word:
//   "Branch KLINIK HIJRAA BANGI only. Remove: the 3 test employees (CLINICAL
//   STAFF, STAFF ADMIN, Dr residen + BOD) and everything attached to them,
//   plus all 2026 payroll runs with their payslips, listings, transfers,
//   filing records and acknowledgements. Keep: the branch, employer and
//   registration numbers, policies, pay components, calendar, statutory
//   tables, all clinical/patient/stock/finance data, every other branch and
//   tenant. Use a one-off logged admin script, not by weakening the approval
//   lock. Log counts before, report them after, confirm 0 employees and no
//   2026 runs. If anything outside this scope would be touched, stop and ask."
//
// HOW IT KEEPS TO THAT
//   * What is attached is asked of the database, not listed by hand: every
//     foreign key that points at a row being removed is followed. A row of an
//     employee's own HR record is removed with them; a row anywhere else that
//     points at them (a policy they edited, a visit, an invoice, a chat
//     message, another employee they manage) STOPS the script, because
//     removing the employee would change or remove it. Nothing is nulled.
//   * A dry run is the default. It is READ ONLY, prints the counts and the
//     verdict, and changes nothing. Only WIPE_APPLY=true deletes, and then
//     only when the dry-run verdict is clean, in ONE transaction that is
//     rolled back if any count differs from the plan.
//   * The approval lock is not weakened. An approved or paid run goes to
//     CANCELLED, the one transition the lock allows, which unlocks its
//     payslip lines. The approved record (payroll_snapshots) and adjustments
//     refuse every delete by design, so those two triggers are switched off
//     INSIDE this transaction only and switched back on before it commits;
//     no other session ever sees them off. No code, migration or trigger
//     definition changes.
//   * It is logged: the counts go to the job log and to one audit_logs row.
//   * No personal data is printed: counts, ids, roles and dates only. A test
//     employee's name is shown only when it is one of the agreed labels.
//
//   * The employees are the three the owner named, matched by those names
//     exactly. Anybody else with an employee record in the branch is kept and
//     reported; WIPE_ALSO_EMPLOYEE_NOS adds an employee by number, only when
//     the owner has said so.
//
// Environment: DATABASE_URL (the OWNER connection: every table is FORCE ROW
// LEVEL SECURITY, so the application role cannot see what it must remove),
// WIPE_APPLY=true to delete, WIPE_ALSO_EMPLOYEE_NOS (comma separated) to
// remove somebody else too. WIPE_BRANCH exists for the local rehearsal only.
import pg from 'pg';

const norm = (text) => (text ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
const APPLY = process.env.WIPE_APPLY === 'true';
const BRANCH = norm(process.env.WIPE_BRANCH ?? 'KLINIK HIJRAA BANGI');
// The three the owner named, by the names they carry on the employee list.
const AGREED = ['DR RESIDEN + BOD', 'CLINICAL STAFF', 'STAFF ADMIN'];
const ALSO = (process.env.WIPE_ALSO_EMPLOYEE_NOS ?? '').split(',').map((no) => no.trim()).filter(Boolean);
const YEAR = 2026;

// An employee's own HR record, and the parts of a payroll run. A row in one of
// these is removed when it belongs to a test employee or to a 2026 run of the
// branch; a row anywhere else that points at what is removed stops the script.
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
  'payroll_warning_acknowledgements',
]);
// The column that says WHOSE a row is. Any other column pointing at a person
// (approved by, edited by, recorded by, manager) is a pointer, not ownership.
const OWNER_COLUMNS = new Set(['staff_id', 'recipient_staff_id', 'user_id']);
// Rows whose owner must be a test employee: anything else is another person's.
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
// Children first: the admin UAT seed's reset order (seed-admin-uat.ts), which
// every CI run proves, cut down to what this script can remove.
const ORDER = [
  'payroll_snapshots', 'payroll_exceptions',
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
// The two locks that refuse every delete. Switched off inside this
// transaction only, and only on a table this script removes rows from.
const LOCKS = { payroll_snapshots: 'payroll_snapshots_no_update', payroll_adjustments: 'payroll_adjustments_append_only_trigger' };

const say = (line = '') => console.log(line);
const q = (id) => `"${id.replace(/"/g, '""')}"`;

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
  await client.connect();
  await client.query('BEGIN');
  if (!APPLY) await client.query('SET TRANSACTION READ ONLY');
  await client.query(`SET LOCAL statement_timeout = '120s'`);
  await client.query(`SET LOCAL lock_timeout = '15s'`);
  say(`Mode: ${APPLY ? 'APPLY (deletes, one transaction)' : 'DRY RUN (read only, changes nothing)'}`);
  say(`Branch: ${BRANCH} · employees named: ${AGREED.join(', ')}${ALSO.length ? ` · also employee no ${ALSO.join(', ')}` : ''} · payroll year: ${YEAR}`);

  // ---- 1. The branch, wherever it is. -------------------------------------
  await client.query(`SELECT set_config('app.bypass_tenant_scope', 'true', true)`);
  const tenants = (await client.query(`SELECT id FROM tenants ORDER BY created_at`)).rows;
  await client.query(`SELECT set_config('app.bypass_tenant_scope', 'false', true)`);
  const found = [];
  for (const tenant of tenants) {
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
    const rows = (
      await client.query(
        `SELECT id, name FROM clinics WHERE tenant_id = $2 AND upper(regexp_replace(btrim(name), '\\s+', ' ', 'g')) = $1`,
        [BRANCH, tenant.id],
      )
    ).rows;
    for (const row of rows) found.push({ tenantId: tenant.id, clinicId: row.id, name: row.name });
  }
  say(`\n== 1. Branch\nTenants scanned: ${tenants.length}. Branches named ${BRANCH}: ${found.length}.`);
  if (found.length !== 1) {
    return stop(`Expected exactly one branch named ${BRANCH}; found ${found.length}. Nothing was changed.`);
  }
  const { tenantId, clinicId } = found[0];
  await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
  const otherBranches = Number(
    (await client.query(`SELECT count(*)::int AS n FROM clinics WHERE tenant_id = $2 AND id <> $1`, [clinicId, tenantId])).rows[0].n,
  );
  say(`Tenant ${tenantId}, branch ${clinicId}. Other branches in this tenant (kept): ${otherBranches}.`);

  // ---- 2. The employees of the branch. ------------------------------------
  const people = (
    await client.query(
      `SELECT s.id, s.role::text AS role, s.user_id, s.full_name, s.active, p.id AS profile_id,
              p.employee_no, p.employment_status::text AS employment_status
         FROM staff s LEFT JOIN employee_profiles p ON p.staff_id = s.id
        WHERE s.clinic_id = $1 AND s.tenant_id = $2
        ORDER BY s.created_at`,
      [clinicId, tenantId],
    )
  ).rows;
  const employees = people.filter((person) => person.profile_id !== null);
  const chosen = employees.filter((person) => AGREED.includes(norm(person.full_name)) || ALSO.includes(String(person.employee_no ?? '')));
  const kept = employees.filter((person) => !chosen.includes(person));
  say(`\n== 2. People of the branch\nWith an employee record: ${employees.length}. Without one (not employees, kept): ${people.length - employees.length}.`);
  for (const person of employees) {
    const label = AGREED.includes(norm(person.full_name)) ? person.full_name : '(name withheld)';
    say(
      `  - ${chosen.includes(person) ? 'REMOVE' : 'keep  '} staff ${person.id} · ${person.role} · ${person.employment_status} · employee no ${person.employee_no ?? '-'} · login ${person.user_id ? 'yes' : 'no'} · ${label}`,
    );
  }
  for (const name of AGREED) {
    const n = employees.filter((person) => norm(person.full_name) === name).length;
    if (n !== 1) return stop(`Expected exactly one employee named ${name} in the branch; found ${n}. Nothing was changed.`);
  }
  for (const no of ALSO) {
    const n = employees.filter((person) => String(person.employee_no ?? '') === no).length;
    if (n !== 1) return stop(`Expected exactly one employee numbered ${no} in the branch; found ${n}. Nothing was changed.`);
  }
  if (kept.length) say(`Kept, not in the agreed list: ${kept.length} employee record(s).`);
  const targets = chosen.map((person) => person.id);
  const targetUsers = chosen.map((person) => person.user_id).filter(Boolean);

  // ---- 3. The branch's 2026 payroll runs. ---------------------------------
  const runs = (
    await client.query(
      `SELECT r.id, to_char(r.period, 'YYYY-MM') AS period, r.status::text AS status, r.run_type::text AS run_type,
              r.clinic_id, (SELECT count(*)::int FROM payroll_lines l WHERE l.payroll_run_id = r.id) AS lines,
              (SELECT count(*)::int FROM payroll_lines l WHERE l.payroll_run_id = r.id AND NOT (l.staff_id = ANY($2::text[]))) AS others,
              (SELECT count(*)::int FROM payroll_lines l WHERE l.payroll_run_id = r.id AND l.staff_id = ANY($2::text[])) AS theirs
         FROM payroll_runs r
        WHERE r.tenant_id = $4 AND r.period >= make_date($3, 1, 1) AND r.period < make_date($3 + 1, 1, 1)
          AND (r.clinic_id = $1 OR r.clinic_id IS NULL)
        ORDER BY r.period, r.sequence`,
      [clinicId, targets, YEAR, tenantId],
    )
  ).rows;
  // A run for the whole tenant is the branch's only when it pays nobody but
  // the test employees; one that pays none of them is another branch's month
  // and is kept.
  const inScope = runs.filter((run) => run.clinic_id !== null || run.theirs > 0);
  const notTheirs = runs.filter((run) => !inScope.includes(run));
  say(`\n== 3. ${YEAR} payroll runs of the branch: ${inScope.length}`);
  for (const run of inScope) {
    say(`  - ${run.period} · ${run.status} · ${run.run_type}${run.clinic_id ? '' : ' · whole tenant'} · ${run.lines} payslip line(s)${run.others ? ` · ${run.others} of other people` : ''}`);
  }
  for (const run of notTheirs) {
    say(`  kept: ${run.period} · ${run.status} · whole tenant · ${run.lines} payslip line(s), none of the test employees`);
  }
  const problems = [];
  for (const run of inScope.filter((r) => r.others > 0)) {
    problems.push(`Run ${run.period} (${run.id}) carries ${run.others} payslip line(s) of people who are not the test employees.`);
  }
  const scopeRuns = inScope.map((run) => run.id);

  // ---- 4. Everything attached, asked of the database. ---------------------
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
  const hasTenant = new Set(
    (await client.query(`SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'tenant_id'`)).rows.map(
      (row) => row.table_name,
    ),
  );
  const inTenant = (table, n) => (hasTenant.has(table) ? ` AND tenant_id = $${n}` : '');
  const withTenant = (table, params) => (hasTenant.has(table) ? [...params, tenantId] : params);
  const hasId = new Set(
    (await client.query(`SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'id'`)).rows.map(
      (row) => row.table_name,
    ),
  );

  /** table -> Set of ids to remove */
  const plan = new Map([
    ['staff', new Set(targets)],
    ['users', new Set(targetUsers)],
    ['payroll_runs', new Set(scopeRuns)],
  ]);
  const valuesOf = async (table, column) => {
    const ids = [...(plan.get(table) ?? [])];
    if (ids.length === 0) return [];
    if (column === 'id') return ids;
    return (await client.query(`SELECT DISTINCT ${q(column)}::text AS v FROM ${q(table)} WHERE id = ANY($1::text[])`, [ids])).rows
      .map((row) => row.v)
      .filter((value) => value !== null);
  };
  const owns = (fk) =>
    HR_RECORD.has(fk.child) &&
    ((fk.parent === 'staff' || fk.parent === 'users')
      ? OWNER_COLUMNS.has(fk.child_col)
      : fk.parent === 'payroll_runs'
        ? fk.child_col === 'payroll_run_id'
        : HR_RECORD.has(fk.parent));

  // Follow ownership to a fixed point.
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
        await client.query(
          `SELECT id FROM ${q(fk.child)} WHERE ${q(fk.child_col)}::text = ANY($1::text[])${inTenant(fk.child, 2)}`,
          withTenant(fk.child, [values]),
        )
      ).rows;
      const set = plan.get(fk.child) ?? new Set();
      for (const row of rows) {
        if (!set.has(row.id)) {
          set.add(row.id);
          grew = true;
        }
      }
      if (set.size) plan.set(fk.child, set);
    }
  }
  // Acknowledgements are keyed by the EPF basis row they acknowledge, not by
  // a foreign key: the test employees' basis rows take theirs with them.
  const bases = [...(plan.get('employee_contribution_bases') ?? [])];
  if (bases.length) {
    const acks = (
      await client.query(
        `SELECT id FROM payroll_warning_acknowledgements WHERE tenant_id = $3 AND (subject_id = ANY($1::text[]) OR subject_id = ANY($2::text[]))`,
        [bases, targets, tenantId],
      )
    ).rows;
    if (acks.length) plan.set('payroll_warning_acknowledgements', new Set([...(plan.get('payroll_warning_acknowledgements') ?? []), ...acks.map((a) => a.id)]));
  }

  // Anything else that points at what is removed: STOP.
  for (const fk of fks.filter((edge) => plan.has(edge.parent))) {
    const values = await valuesOf(fk.parent, fk.parent_col);
    if (values.length === 0) continue;
    const planned = [...(plan.get(fk.child) ?? [])];
    const sql = hasId.has(fk.child)
      ? `SELECT count(*)::int AS n FROM ${q(fk.child)} WHERE ${q(fk.child_col)}::text = ANY($1::text[]) AND NOT (id::text = ANY($2::text[]))`
      : `SELECT count(*)::int AS n FROM ${q(fk.child)} WHERE ${q(fk.child_col)}::text = ANY($1::text[])`;
    const n = Number((await client.query(sql, hasId.has(fk.child) ? [values, planned] : [values])).rows[0].n);
    if (n > 0) {
      const effect = { a: 'refuses the delete', r: 'refuses the delete', c: 'would be deleted with it', n: 'would be cleared to empty', d: 'would be reset' }[fk.on_delete] ?? fk.on_delete;
      problems.push(`${n} row(s) of ${fk.child}.${fk.child_col} point at ${fk.parent} being removed, and are outside the agreed scope (${effect}).`);
    }
  }
  // Rows of a run outside the scope, and rows that are another person's. The
  // one exception: a calculation warning about a test employee in a month
  // that is not approved is theirs, and that month works its warnings out
  // again the next time it is calculated. In an approved month it is part of
  // a locked record, and the script stops.
  const draftWarnings = [];
  for (const [table, ids] of plan) {
    const columns = fks.filter((edge) => edge.child === table && edge.parent === 'payroll_runs').map((edge) => edge.child_col);
    for (const column of columns) {
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
        if (table === 'payroll_exceptions' && row.status !== 'APPROVED' && row.status !== 'PAID') {
          draftWarnings.push(row);
        } else {
          problems.push(`${row.n} row(s) of ${table} belong to the ${row.period} ${row.status} run${row.clinic_id ? '' : ' for the whole tenant'}, which is not in the agreed scope.`);
        }
      }
    }
    const owner = OWNED_BY[table];
    if (owner) {
      const n = Number(
        (
          await client.query(
            `SELECT count(*)::int AS n FROM ${q(table)} WHERE id = ANY($1::text[]) AND ${q(owner)} IS NOT NULL AND NOT (${q(owner)}::text = ANY($2::text[]))`,
            [[...ids], targets],
          )
        ).rows[0].n,
      );
      if (n > 0) problems.push(`${n} row(s) of ${table} belong to somebody who is not one of the test employees.`);
    }
  }
  for (const table of plan.keys()) {
    if (!ORDER.includes(table)) problems.push(`${table} has rows to remove but no agreed place in the delete order.`);
  }

  // ---- 5. The plan: counts before. ----------------------------------------
  const before = {};
  for (const table of ORDER) if (plan.get(table)?.size) before[table] = plan.get(table).size;
  say(`\n== 4. To remove (counts before)`);
  for (const [table, n] of Object.entries(before)) say(`  ${table.padEnd(38)} ${String(n).padStart(6)}`);
  say(`  ${'TOTAL'.padEnd(38)} ${String(Object.values(before).reduce((a, b) => a + b, 0)).padStart(6)}`);
  const triggers = (
    await client.query(
      `SELECT c.relname AS tbl, t.tgname AS name FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE NOT t.tgisinternal AND c.relname = ANY($1::text[]) ORDER BY 1, 2`,
      [Object.keys(before)],
    )
  ).rows;
  say(`Triggers on these tables: ${triggers.map((t) => `${t.tbl}.${t.name}`).join(', ') || 'none'}.`);
  for (const row of draftWarnings) {
    say(
      `Of the payroll_exceptions above, ${row.n} are warnings about the test employees in the ${row.period} ${row.status} run` +
        `${row.clinic_id ? '' : ' for the whole tenant'}, which is kept; that month works its warnings out again when next calculated.`,
    );
  }

  say(`\n== 5. Out of scope`);
  if (problems.length) {
    for (const problem of problems) say(`  STOP: ${problem}`);
    return stop(`${problems.length} thing(s) outside the agreed scope would be touched. Nothing was changed. Ask the owner.`);
  }
  say('  Nothing outside the agreed scope points at what would be removed.');
  if (!APPLY) {
    await client.query('ROLLBACK');
    say(`\nVERDICT: SAFE TO APPLY. Dry run: nothing was changed.`);
    return 0;
  }

  // ---- 6. Apply, in this one transaction. ---------------------------------
  const cancelled = await client.query(
    `UPDATE payroll_runs SET status = 'CANCELLED' WHERE id = ANY($1::text[]) AND status IN ('APPROVED', 'PAID')`,
    [scopeRuns],
  );
  say(`\n== 6. Applying\nApproved or paid runs cancelled first (the lock's own allowed transition): ${cancelled.rowCount}.`);
  const switchedOff = [];
  for (const [table, trigger] of Object.entries(LOCKS)) {
    if (!before[table]) continue;
    if (!triggers.some((t) => t.tbl === table && t.name === trigger)) continue;
    await client.query(`ALTER TABLE ${q(table)} DISABLE TRIGGER ${q(trigger)}`);
    switchedOff.push([table, trigger]);
    say(`Lock ${table}.${trigger} switched off inside this transaction.`);
  }
  for (const table of ORDER) {
    const ids = [...(plan.get(table) ?? [])];
    if (ids.length === 0) continue;
    const result = await client.query(`DELETE FROM ${q(table)} WHERE id = ANY($1::text[])${inTenant(table, 2)}`, withTenant(table, [ids]));
    if (result.rowCount !== ids.length) {
      throw new Error(`${table}: planned ${ids.length}, deleted ${result.rowCount}. Rolled back; nothing was changed.`);
    }
  }
  for (const [table, trigger] of switchedOff) {
    await client.query(`ALTER TABLE ${q(table)} ENABLE TRIGGER ${q(trigger)}`);
    say(`Lock ${table}.${trigger} switched back on.`);
  }

  // ---- 7. Counts after, then the record of it. ----------------------------
  const after = {};
  for (const [table, set] of plan) {
    after[table] = Number((await client.query(`SELECT count(*)::int AS n FROM ${q(table)} WHERE id = ANY($1::text[])`, [[...set]])).rows[0].n);
  }
  const employeesLeft = Number(
    (
      await client.query(
        `SELECT count(*)::int AS n FROM staff s JOIN employee_profiles p ON p.staff_id = s.id WHERE s.clinic_id = $1 AND s.tenant_id = $2`,
        [clinicId, tenantId],
      )
    ).rows[0].n,
  );
  const removedLeft = Number((await client.query(`SELECT count(*)::int AS n FROM staff WHERE id = ANY($1::text[])`, [targets])).rows[0].n);
  const runsLeft = Number(
    (
      await client.query(
        `SELECT count(*)::int AS n FROM payroll_runs
          WHERE tenant_id = $3 AND (clinic_id = $1 OR id = ANY($4::text[])) AND period >= make_date($2, 1, 1) AND period < make_date($2 + 1, 1, 1)`,
        [clinicId, YEAR, tenantId, scopeRuns],
      )
    ).rows[0].n,
  );
  const locksOn = (
    await client.query(
      `SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relname = ANY($1::text[]) AND t.tgname = ANY($2::text[]) AND t.tgenabled <> 'D'`,
      [Object.keys(LOCKS), Object.values(LOCKS)],
    )
  ).rows[0].n;
  say(`\n== 7. Counts after\nRows of the plan still present: ${Object.values(after).reduce((a, b) => a + b, 0)}.`);
  say(
    `Employees removed still present: ${removedLeft}. Employees in the branch: ${employeesLeft} (kept, not in the agreed list: ${kept.length}). ` +
      `${YEAR} payroll runs of the branch: ${runsLeft}. Locks on: ${locksOn} of ${Object.keys(LOCKS).length}.`,
  );
  if (removedLeft !== 0 || employeesLeft !== kept.length || runsLeft !== 0 || Object.values(after).some((n) => n !== 0) || locksOn !== Object.keys(LOCKS).length) {
    throw new Error('The branch is not clean after the delete. Rolled back; nothing was changed.');
  }
  await client.query(
    `INSERT INTO audit_logs (id, tenant_id, actor_user_id, action, entity_type, entity_id, before, after, created_at)
     VALUES (gen_random_uuid()::text, $1, NULL, 'admin.branchTestDataWiped', 'Clinic', $2, $3::jsonb, $4::jsonb, now())`,
    [
      tenantId,
      clinicId,
      JSON.stringify({ removed: before, employees: targets, runs: scopeRuns }),
      JSON.stringify({
        employeesInBranch: employeesLeft,
        keptNotInAgreedList: kept.length,
        runsIn2026: runsLeft,
        _reason: 'One-off wipe of the branch test data, agreed with the clinic owner on 10 October 2026.',
        _source: 'scripts/wipe-hijraa-bangi-test-data.mjs',
      }),
    ],
  );
  await client.query('COMMIT');
  say(
    `\nDONE. Committed. ${targets.length} employee(s) removed, ${kept.length} kept; no ${YEAR} payroll runs in ${BRANCH}; one audit_logs row records it.`,
  );
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
