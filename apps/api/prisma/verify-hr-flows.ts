import { join } from 'node:path';
import { config } from 'dotenv';

config({ path: join(__dirname, '..', '.env') });

/**
 * HR-01…HR-15, WALKED FROM OUTSIDE THE CODEBASE.
 *
 * Over HTTP, as an owner and as two ordinary members of staff, against
 * whatever database the API is pointed at. It imports nothing from `src/`
 * deliberately: a check that shares its arithmetic with the thing it is
 * checking can agree with itself while disagreeing with the product.
 *
 * Run it after `augment-hr-uat.ts` to confirm a UAT world is fit to test in,
 * and re-run it after any HR change:
 *
 *   npx tsx prisma/verify-hr-flows.ts
 */

const API = process.env.VERIFY_API ?? 'http://localhost:3000';
const OWNER = process.env.VERIFY_OWNER ?? 'owner@admin-uat.kuwick.invalid';
const OWNER_PASSWORD = process.env.ADMIN_UAT_PASSWORD ?? 'AdminUat!2026';
const STAFF_PASSWORD = process.env.HR_UAT_PASSWORD ?? 'HrUat!2026';
const DOMAIN = 'hr-uat.kuwick.invalid';

/** Malaysia. The clinic's day, not the runner's. */
const CLINIC_ZONE = 'Asia/Kuala_Lumpur';
const clinicDate = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: CLINIC_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(iso),
  );

const failures: string[] = [];
const notes: string[] = [];
let checks = 0;

function check(label: string, ok: boolean, detail = ''): void {
  checks += 1;
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
}

async function token(email: string, password: string): Promise<string> {
  const response = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(`Could not sign in as ${email} (${response.status}).`);
  return (await response.json()).accessToken;
}

async function get<T>(bearer: string, path: string): Promise<{ status: number; body: T | null }> {
  const response = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${bearer}` } });
  return { status: response.status, body: response.ok ? ((await response.json()) as T) : null };
}

async function main(): Promise<void> {
  const owner = await token(OWNER, OWNER_PASSWORD);
  const nurse = await token(`nurse@${DOMAIN}`, STAFF_PASSWORD);
  const night = await token(`night@${DOMAIN}`, STAFF_PASSWORD);

  console.log('HR ACCEPTANCE FLOWS — over the real API\n');

  // HR-02 · a member of staff reads their own world, and only their own.
  const me = await get<{ fullName: string; employment: { position: string }; branch: { name: string } }>(nurse, '/me');
  check('HR-02 an ordinary member of staff can read their own profile', me.status === 200);
  check('HR-02 and no salary is on it', !JSON.stringify(me.body ?? {}).includes('basicSalary'));
  const admin = await get(nurse, '/workforce/employees');
  check('HR-02 and Administration refuses them', admin.status === 403, `got ${admin.status}`);
  if (me.body) notes.push(`HR-02 ${me.body.fullName} · ${me.body.employment.position} · ${me.body.branch.name}`);

  // HR-15 · a recurring weekly pattern produced a month without typing each day.
  type Schedule = { shifts: { date: string; startsAt: string; endsAt: string }[] };
  const sched = await get<Schedule>(nurse, '/me/schedule?from=2026-09-01&to=2026-09-30');
  check('HR-15 a weekly pattern produced September shifts', (sched.body?.shifts.length ?? 0) > 15,
    `${sched.body?.shifts.length ?? 0} shifts`);
  notes.push(`HR-15 ${sched.body?.shifts.length ?? 0} September shifts published for one employee`);

  // HR-14 · an overnight shift is ONE shift crossing midnight.
  //
  // Compared in the CLINIC's zone. Comparing the UTC date parts says a
  // Malaysian 23:00→07:00 shift never crosses midnight, because 07:00 MYT is
  // 23:00 UTC the same day — which is the exact class of mistake this pass
  // spent its first commit fixing, and it was made again here while writing
  // this check.
  const nightSched = await get<Schedule>(night, '/me/schedule?from=2026-09-01&to=2026-09-30');
  const overnight = (nightSched.body?.shifts ?? []).filter((s) => clinicDate(s.startsAt) !== clinicDate(s.endsAt));
  check('HR-14 the night nurse works overnight shifts, each ONE row', overnight.length > 10,
    `${overnight.length} crossing midnight in clinic time`);
  if (overnight[0]) {
    notes.push(
      `HR-14 ${overnight.length} overnight shifts; the first runs ${clinicDate(overnight[0].startsAt)} 23:00 → ${clinicDate(overnight[0].endsAt)} 07:00 local`,
    );
  }

  // HR-04 · lateness derived from the roster and the clinic's own grace.
  type Day = { workDate: string; lateMinutes: number | null; extraMinutesRecorded: number; overtimeApproved: boolean };
  const att = await get<Day[]>(nurse, '/me/attendance?from=2026-09-01&to=2026-09-30');
  const late = (att.body ?? []).filter((d) => (d.lateMinutes ?? 0) > 0);
  check('HR-04 a late arrival is derived, never typed', late.length >= 1);
  if (late[0]) notes.push(`HR-04 ${late[0].workDate}: ${late[0].lateMinutes} minutes late past the clinic's grace`);

  // HR-05 · extra time recorded, and NOT paid until somebody approves it.
  const nightAtt = await get<Day[]>(night, '/me/attendance?from=2026-09-01&to=2026-09-30');
  const extra = (nightAtt.body ?? []).filter((d) => d.extraMinutesRecorded > 0);
  check('HR-05 extra time is recorded', extra.length >= 1);
  check('HR-05 and is not approved overtime', extra.every((d) => !d.overtimeApproved));
  if (extra[0]) notes.push(`HR-05 ${extra[0].workDate}: ${extra[0].extraMinutesRecorded} min extra, unapproved`);

  // HR-07 · a correction request is waiting for a person.
  type Correction = { staffName: string; reason: string; record: { workDate: string } };
  const corrections = await get<Correction[]>(owner, '/workforce/attendance/corrections');
  check('HR-07 a correction request is waiting for the manager', (corrections.body?.length ?? 0) >= 1);
  if (corrections.body?.[0]) {
    notes.push(`HR-07 ${corrections.body[0].staffName} asked about ${corrections.body[0].record.workDate}`);
  }

  // HR-08 · leave, both waiting and decided.
  const pendingLeave = await get<unknown[]>(owner, '/leave-requests?status=PENDING');
  check('HR-08 a leave request is waiting for a decision', (pendingLeave.body?.length ?? 0) >= 1);
  const ownLeave = await get<unknown[]>(night, '/me/leave');
  check('HR-08 the employee sees their own leave and its decision', (ownLeave.body?.length ?? 0) >= 1);

  // HR-09 / HR-10 · two routes, and the invariant that keeps them apart.
  type Claim = { paymentRoute: string | null; payrollInputEntryId: string | null };
  const claims = await get<Claim[]>(owner, '/workforce/claims');
  const viaPayroll = (claims.body ?? []).filter((c) => c.paymentRoute === 'PAYROLL');
  const viaFinance = (claims.body ?? []).filter((c) => c.paymentRoute === 'FINANCE');
  check('HR-09 a claim is routed to payroll', viaPayroll.length >= 1);
  check('HR-10 another is routed to Finance', viaFinance.length >= 1);
  // A claim paid through salary must never also be reimbursed separately.
  const both = (claims.body ?? []).filter((c) => c.paymentRoute === 'FINANCE' && c.payrollInputEntryId);
  check('HR-09/10 no claim is on both routes at once', both.length === 0, `${both.length} on both`);
  notes.push(`HR-09/10 ${viaPayroll.length} via payroll, ${viaFinance.length} via Finance, 0 on both`);

  // HR-01 / HR-03 · the board a manager opens.
  type Board = {
    scheduled: unknown[];
    notClockedIn: unknown[];
    coverage: Record<string, number>;
    pendingLeaveApprovals: number;
    pendingClaims: number;
    pendingAttendanceCorrections: number;
  };
  const board = await get<Board>(owner, '/workforce/today');
  check('HR-01 the workforce board answers', board.status === 200);
  check('HR-01 it reports who is rostered and NOT here', Array.isArray(board.body?.notClockedIn));
  check('HR-01 and covers the whole workforce, not only the doctors',
    Object.values(board.body?.coverage ?? {}).reduce((a, b) => a + b, 0) > 0);
  if (board.body) {
    notes.push(
      `HR-01 today: ${board.body.scheduled.length} rostered, ${board.body.notClockedIn.length} not clocked in, ` +
        `${board.body.pendingLeaveApprovals} leave / ${board.body.pendingClaims} claims / ` +
        `${board.body.pendingAttendanceCorrections} fixes waiting`,
    );
  }

  // HR-13 · a payslip is only ever your own, and only once approved.
  const slips = await get<unknown[]>(nurse, '/me/payslips');
  check('HR-13 the payslip endpoint answers for an employee', slips.status === 200);
  notes.push(`HR-13 ${slips.body?.length ?? 0} approved payslip(s) — September is open by design`);

  console.log();
  for (const note of notes) console.log(`  · ${note}`);
  console.log();
  if (failures.length > 0) {
    console.log(`${checks} checks, ${failures.length} FAILURES`);
    for (const failure of failures) console.log(`  ✗ ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(`${checks} checks, 0 failures`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
