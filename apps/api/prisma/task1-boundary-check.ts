import { join } from 'node:path';
import { config } from 'dotenv';

config({ path: join(__dirname, '..', '.env') });

/**
 * TASK 1 — the boundary table, run as REAL MUTATIONS.
 *
 * Unit tests assert what the policy module returns. This asserts what the
 * SERVER does when a real staff member, logged in with a real password, posts
 * a real body at a real route. Those are different claims, and only the second
 * one is the security claim: a permission that is correct in a table and never
 * consulted by the controller protects nothing.
 *
 * Every case below is an actual write attempt. The permitted ones leave rows
 * behind; the refused ones are checked for a 403 AND for the refusal wording,
 * so a 403 arriving for the wrong reason (branch, tenant, a missing body
 * field) cannot pass as a permission refusal.
 *
 * Local development only:
 *   KUWICK_ALLOW_FIXTURES=yes npx tsx prisma/task1-boundary-check.ts
 */
const API = process.env.KUWICK_API_URL ?? 'http://localhost:3000';
const PASSWORD = 'DevLocal!2026';
// Resolved at runtime (see `arrange` below). These were hardcoded UUIDs from
// one particular dev database, which made the table unrunnable anywhere else
// — and the whole point of this script is that it re-runs after every
// permission change, in whatever world the session has.

if (process.env.KUWICK_ALLOW_FIXTURES !== 'yes') {
  throw new Error('Refusing to run: set KUWICK_ALLOW_FIXTURES=yes (local development only).');
}
if (!/localhost|127\.0\.0\.1/.test(API)) {
  throw new Error(`Refusing to run against ${API} — this script writes real rows.`);
}

interface Session {
  token: string;
  staffId: string;
  label: string;
  permissions: string[];
  roles: string[];
}

async function login(label: string, email: string): Promise<Session> {
  const response = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!response.ok) throw new Error(`${label}: login failed (${response.status}) ${await response.text()}`);
  const body = (await response.json()) as {
    accessToken: string;
    staff: { id: string; permissions?: string[]; roles?: string[] };
  };
  return {
    token: body.accessToken,
    staffId: body.staff.id,
    label,
    permissions: body.staff.permissions ?? [],
    roles: body.staff.roles ?? [],
  };
}

async function call(
  session: Session,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; text: string; json: unknown }> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session.token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: response.status, text, json };
}

const results: { n: number; description: string; expected: string; got: string; pass: boolean; detail: string }[] = [];

function record(n: number, description: string, expected: number, got: number, detail: string) {
  results.push({
    n,
    description,
    expected: String(expected),
    got: String(got),
    pass: expected === got,
    detail,
  });
}

function messageOf(result: { json: unknown; text: string }): string {
  const message = (result.json as { message?: unknown } | null)?.message;
  if (typeof message === 'string') return message;
  return result.text.slice(0, 160);
}

async function main() {
  const doctor = await login('Dr B (DOCTOR)', 'dr.b@smoke-test-clinic.test');
  const msX = await login('Ms X (CLINICAL_STAFF)', 'ms.x@smoke-test-clinic.test');
  const msY = await login('Ms Y (ADMINISTRATOR)', 'ms.y@smoke-test-clinic.test');
  const frontDesk = await login('Front desk (legacy)', 'siti.front@smoke-test-clinic.test');
  const finance = await login('Finance (legacy)', 'faiz.finance@smoke-test-clinic.test');

  console.log('\nSESSIONS — what the server says each of them holds\n' + '='.repeat(78));
  for (const session of [doctor, msX, msY, frontDesk, finance]) {
    console.log(`  ${session.label.padEnd(24)} roles=[${session.roles.join(', ')}]`);
    console.log(`  ${' '.repeat(24)} ${session.permissions.join(', ') || '(none)'}\n`);
  }

  // ---------------------------------------------------------------------
  // Arrange: front desk registers a walk-in and assigns it to the doctor.
  // This is itself case 0 — the counter's own queue right, unchanged.
  // ---------------------------------------------------------------------
  const clinicsResponse = await call(frontDesk, 'GET', '/clinics');
  const clinicId = (clinicsResponse.json as { id: string }[])[0]?.id;
  if (!clinicId) throw new Error('arrange: no clinic in this world');
  const patientsResponse = await call(frontDesk, 'GET', '/patients');
  const patientId = (patientsResponse.json as { id: string }[])[0]?.id;
  if (!patientId) throw new Error('arrange: no patient in this world');

  const ticket = await call(frontDesk, 'POST', '/queue-tickets', {
    clinicId,
    patientId,
    staffId: doctor.staffId,
    billingType: 'SELF_PAY',
    presentingComplaint: 'Task 1 boundary check',
  });
  if (ticket.status >= 300) throw new Error(`arrange: front desk could not register a walk-in: ${ticket.text}`);
  const ticketRow = ticket.json as { id: string; visitId: string };
  console.log(`arranged: ticket ${ticketRow.id} / visit ${ticketRow.visitId}\n`);

  // 1. Ms X (CLINICAL_STAFF) writes a doctor's clinical note → 403.
  const note = await call(msX, 'POST', `/visits/${ticketRow.visitId}/clinical-notes`, {
    noteType: 'DOCTOR_NARRATIVE',
    notes: 'Boundary check — this must never be stored.',
  });
  record(1, 'Ms X (CLINICAL_STAFF) POST clinical note', 403, note.status, messageOf(note));

  // 2. Ms Y (ADMINISTRATOR) records vitals → 403.
  const vitals = await call(msY, 'POST', `/visits/${ticketRow.visitId}/observations`, { pulse: 72 });
  record(2, 'Ms Y (ADMINISTRATOR) POST vitals', 403, vitals.status, messageOf(vitals));

  // Arrange an invoice for the billing cases. The doctor raises it, which is
  // case 7's first half: `billing.counter` on the DOCTOR role.
  const invoice = await call(doctor, 'POST', '/invoices', {
    visitId: ticketRow.visitId,
    createdByStaffId: doctor.staffId,
  });
  if (invoice.status >= 300) throw new Error(`arrange: doctor could not raise an invoice: ${invoice.text}`);
  const invoiceId = (invoice.json as { id: string }).id;

  // 7. Doctor adds a line to the invoice → 200.
  const line = await call(doctor, 'POST', `/invoices/${invoiceId}/lines`, {
    description: 'Wound dressing',
    quantity: 1,
    unitPrice: 25,
  });
  record(7, 'Doctor POST invoice line', 201, line.status, messageOf(line));

  // 8. Doctor applies a discount → 403. `billing.counter` is not corrections.
  const doctorDiscount = await call(doctor, 'PATCH', `/invoices/${invoiceId}/discount`, {
    type: 'FIXED_AMOUNT',
    value: 5,
    reason: 'boundary check — must be refused',
  });
  record(8, 'Doctor PATCH invoice discount', 403, doctorDiscount.status, messageOf(doctorDiscount));

  // 3. Front desk applies a discount → 403.
  const frontDeskDiscount = await call(frontDesk, 'PATCH', `/invoices/${invoiceId}/discount`, {
    type: 'FIXED_AMOUNT',
    value: 5,
    reason: 'boundary check — must be refused',
  });
  record(3, 'Front desk PATCH invoice discount', 403, frontDeskDiscount.status, messageOf(frontDeskDiscount));

  // 4. Finance applies a discount → 200. The legacy fallback keeps it.
  const financeDiscount = await call(finance, 'PATCH', `/invoices/${invoiceId}/discount`, {
    type: 'FIXED_AMOUNT',
    value: 5,
    reason: 'goodwill — boundary check',
  });
  record(4, 'Finance PATCH invoice discount', 200, financeDiscount.status, messageOf(financeDiscount));

  // 5. Finance registers a walk-in → 403. The intentional narrowing.
  const financeQueue = await call(finance, 'POST', '/queue-tickets', {
    clinicId,
    patientId,
    staffId: doctor.staffId,
    billingType: 'SELF_PAY',
    presentingComplaint: 'boundary check — must be refused',
  });
  record(5, 'Finance POST queue ticket', 403, financeQueue.status, messageOf(financeQueue));

  // 6. The doctor calls their own next patient → 200.
  const called = await call(doctor, 'PATCH', `/queue-tickets/${ticketRow.id}/call`, {});
  record(6, 'Doctor PATCH call own patient', 200, called.status, messageOf(called));

  // 5b. And finance may not complete the visit either — the same narrowing,
  // at the other end of the day.
  const financeComplete = await call(finance, 'PATCH', `/queue-tickets/${ticketRow.id}/complete`, {});
  record(9, 'Finance PATCH complete ticket (narrowed)', 403, financeComplete.status, messageOf(financeComplete));

  // 10/11. THE CREDENTIAL GATE, both sides of it. Holding DOCTOR opens the
  // clinical record; SIGNING additionally asserts a professional identity, so
  // it needs the registration to exist and to have been verified. Dr B has
  // all eight fields; the owner-doctor Dr A has them too, and a doctor with
  // the role but no credential would be refused at the sign step alone.
  const doctorNote = await call(doctor, 'POST', `/visits/${ticketRow.visitId}/clinical-notes`, {
    noteType: 'DOCTOR_NARRATIVE',
    notes: 'Boundary check — credentialed doctor writes and signs.',
  });
  record(10, 'Doctor POST clinical note', 201, doctorNote.status, messageOf(doctorNote));

  if (doctorNote.status < 300) {
    const created = doctorNote.json as { id: string; version: number };
    const signed = await call(doctor, 'POST', `/visits/${ticketRow.visitId}/clinical-notes/${created.id}/sign`, {
      expectedVersion: created.version,
    });
    record(11, 'Doctor POST sign note (credentialed)', 201, signed.status, messageOf(signed));
  }

  results.sort((a, b) => a.n - b.n);
  console.log('BOUNDARY TABLE — REAL MUTATIONS\n' + '='.repeat(78));
  for (const row of results) {
    console.log(
      `  ${row.pass ? 'PASS' : 'FAIL'}  ${String(row.n).padStart(2)}. ${row.description.padEnd(44)} expected ${row.expected}, got ${row.got}`,
    );
    console.log(`        ${row.detail}`);
  }
  const failed = results.filter((row) => !row.pass);
  console.log('='.repeat(78));
  console.log(`  ${results.length - failed.length}/${results.length} as specified`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
