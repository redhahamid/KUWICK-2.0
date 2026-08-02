import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import * as jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { chromium } from 'playwright-core';
import { FixtureLedger, assertFixturesAllowed, fixtureLabel, sweepOrphanedFixtures } from './fixture-support';

config({ path: join(__dirname, '..', '.env') });

// G3c closure (D-066) — billing authorisation on the five invoice mutation
// routes and the billing page, against the REAL database, HTTP API and Chrome.
//
//   KUWICK_ALLOW_FIXTURES=yes npx tsx prisma/g3c-closure-billing-rbac-check.ts [--shots]
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const API = 'http://localhost:3000';
const WEB = 'http://localhost:5173';
const SHOTS = process.argv.includes('--shots');
const OUT = join(__dirname, '..', '..', '..', 'docs', 'g3-screenshots');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
let ledger: FixtureLedger | undefined;
// Staff/users this run creates, removed in the finally block. The ledger does
// not track staff, so their cleanup is explicit and scoped to these ids only.
const fixtureStaffIds: string[] = [];
const fixtureUserIds: string[] = [];

const results: { name: string; pass: boolean; detail: string }[] = [];
function check(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

async function call(path: string, token: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function api(path: string, token: string, method = 'GET', body?: unknown) {
  const r = await call(path, token, method, body);
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

async function main() {
  assertFixturesAllowed();
  if (SHOTS) mkdirSync(OUT, { recursive: true });

  const tokenFor = (s: { user_id: string; tenant_id: string; staff_id: string; role: string }) =>
    jwt.sign(
      { sub: s.user_id, tenantId: s.tenant_id, staffId: s.staff_id, role: s.role },
      process.env.JWT_ACCESS_SECRET as string,
      { expiresIn: '40m' },
    );

  // Anchor on a tenant that actually HAS clinics and patients. Picking "the
  // first OWNER_ADMIN anywhere" landed on an empty tenant, and asking SQL
  // which tenants have clinical data hits the D-048 trap — clinics/visits are
  // FORCE'd and not covered by the bypass GUC, so the EXISTS silently returns
  // nothing. So the candidates come from SQL and the decision comes from the
  // API, which is the same view the application itself has.
  const candidates = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    return tx.$queryRawUnsafe<
      { user_id: string; staff_id: string; tenant_id: string; role: string; full_name: string; tenant_name: string }[]
    >(`
      SELECT u.id AS user_id, s.id AS staff_id, s.tenant_id, s.role, s.full_name, t.name AS tenant_name
      FROM staff s
      JOIN users u ON s.user_id = u.id
      JOIN tenants t ON t.id = s.tenant_id
      WHERE s.active
      ORDER BY CASE s.role WHEN 'OWNER_ADMIN' THEN 0 ELSE 1 END`);
  });

  let seed: (typeof candidates)[number] | undefined;
  let seedToken = '';
  const probed = new Set<string>();
  for (const candidate of candidates) {
    if (probed.has(candidate.tenant_id)) continue;
    probed.add(candidate.tenant_id);
    const token = tokenFor(candidate);
    const clinicProbe = await call('/clinics', token);
    const patientProbe = await call('/patients', token);
    if (clinicProbe.status === 200 && patientProbe.status === 200 &&
        clinicProbe.body.length > 0 && patientProbe.body.length > 0) {
      seed = candidate;
      seedToken = token;
      break;
    }
    console.log(`  skipping "${candidate.tenant_name}" — ${clinicProbe.body?.length ?? 0} clinic(s), ${patientProbe.body?.length ?? 0} patient(s)`);
  }
  if (!seed) throw new Error('No tenant with a login, a clinic and a patient.');
  console.log(`Anchor tenant: ${seed.tenant_name} · seeded from ${seed.role} (${seed.full_name})`);

  const swept = await sweepOrphanedFixtures(prisma, seed.tenant_id);
  if (swept > 0) console.log(`Swept ${swept} leftover fixture visit(s)`);
  ledger = new FixtureLedger(prisma, API, seedToken, seed.tenant_id);

  // ------------------------------------------------- real roles in this DB
  const existing = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    return tx.$queryRawUnsafe<{ user_id: string; staff_id: string; role: string; full_name: string }[]>(`
      SELECT u.id AS user_id, s.id AS staff_id, s.role, s.full_name
      FROM staff s JOIN users u ON s.user_id = u.id
      WHERE s.active AND s.tenant_id = '${seed.tenant_id}'`);
  });
  console.log(`Real accounts with a login: ${existing.map((s) => s.role).join(', ') || '(none)'}`);

  // §10 — every role the matrix distinguishes has to be exercised, and this
  // tenant does not have a login for all of them. Use the real account where
  // one exists; otherwise seed a clearly tagged fixture, removed in cleanup.
  // A seeded staff member is authorised by exactly the same rule as a real
  // one, so the result is the same test either way.
  let stamp = Date.now();
  const ensureActor = async (role: string, label: string) => {
    const real = existing.find((s) => (role === 'DOCTOR_' ? s.role.startsWith('DOCTOR_') : s.role === role));
    if (real) return { ...real, seeded: false };
    stamp += 1;
    const created = await api('/staff', seedToken, 'POST', {
      fullName: fixtureLabel(label),
      role: role === 'DOCTOR_' ? 'DOCTOR_RESIDENT' : role,
      loginEmail: `kuwick-fixture-${stamp}@example.invalid`,
      loginPassword: `Fixture!${stamp}`,
    });
    fixtureStaffIds.push(created.id);
    if (created.userId) fixtureUserIds.push(created.userId);
    return {
      user_id: created.userId as string,
      staff_id: created.id as string,
      role: created.role as string,
      full_name: created.fullName as string,
      seeded: true,
    };
  };

  const stock = await ensureActor('STOCK_STAFF', 'G3c Stock Staff');
  const doctor = await ensureActor('DOCTOR_', 'G3c Doctor');
  const frontDesk = await ensureActor('FRONT_DESK_CLINICAL_STAFF', 'G3c Front Desk');
  // The fully-authorised billing actor the "authorised workflow still works"
  // checks act as — an owner if this tenant has one, otherwise a tagged one.
  const owner = await ensureActor('OWNER_ADMIN', 'G3c Billing Owner');
  const stockToken = tokenFor({ ...stock, tenant_id: seed.tenant_id });
  const ownerToken = tokenFor({ ...owner, tenant_id: seed.tenant_id });
  check(
    'every role the billing matrix distinguishes has an account to test with',
    Boolean(stock.staff_id && doctor.staff_id && frontDesk.staff_id && owner.staff_id),
    [owner, doctor, frontDesk, stock].map((s) => `${s.role}${s.seeded ? ' (fixture)' : ' (real)'}`).join(', '),
  );

  // ---------------------------------------------------------- the scenario
  const clinics = await api('/clinics', ownerToken);
  const patients = await api('/patients', ownerToken);
  if (clinics.length === 0 || patients.length === 0) {
    throw new Error(`Anchor tenant "${seed.tenant_name}" has ${clinics.length} clinic(s) and ${patients.length} patient(s) — nothing to bill.`);
  }
  const visitA = await api('/visits', ownerToken, 'POST', {
    clinicId: clinics[0].id, patientId: patients[0].id, staffId: doctor.staff_id,
    billingType: 'Cash', presentingComplaint: fixtureLabel('G3c closure billing A'),
  });
  ledger.visit(visitA.id);
  const visitB = await api('/visits', ownerToken, 'POST', {
    clinicId: clinics[0].id, patientId: patients[0].id, staffId: doctor.staff_id,
    billingType: 'Cash', presentingComplaint: fixtureLabel('G3c closure billing B'),
  });
  ledger.visit(visitB.id);

  const invA = await api('/invoices', ownerToken, 'POST', {
    visitId: visitA.id, createdByStaffId: owner.staff_id,
  });
  await api(`/invoices/${invA.id}/lines`, ownerToken, 'POST', { description: 'Consultation', unitPrice: 40 });
  const invB = await api('/invoices', ownerToken, 'POST', {
    visitId: visitB.id, createdByStaffId: owner.staff_id,
  });

  // ================================================== §10.3-7 direct API denial
  const deniedChecks: [string, () => Promise<{ status: number }>][] = [
    ['create an invoice', () => call('/invoices', stockToken, 'POST', { visitId: visitA.id, createdByStaffId: owner.staff_id })],
    ['add a line', () => call(`/invoices/${invA.id}/lines`, stockToken, 'POST', { description: 'X', unitPrice: 5 })],
    ['remove a line', () => call(`/invoices/${invA.id}/lines/whatever`, stockToken, 'DELETE')],
    ['pay', () => call(`/invoices/${invA.id}/pay`, stockToken, 'PATCH', { paymentMethod: 'CASH' })],
    ['cancel', () => call(`/invoices/${invA.id}/cancel`, stockToken, 'PATCH', { cancelReason: 'x' })],
  ];
  for (const [what, run] of deniedChecks) {
    const res = await run();
    check(`STOCK_STAFF cannot ${what} via the API directly`, res.status === 403, `HTTP ${res.status}`);
  }

  // §7 — action-specific rules. The interesting cases are the ones where a
  // role is trusted with part of billing but not all of it.
  {
    const dToken = tokenFor({ ...doctor, tenant_id: seed.tenant_id });
    const created = await call('/invoices', dToken, 'POST', { visitId: visitB.id, createdByStaffId: doctor.staff_id });
    check('a doctor MAY raise an invoice (their own visit charges)', created.status === 201, `HTTP ${created.status}`);
    const paid = await call(`/invoices/${invA.id}/pay`, dToken, 'PATCH', { paymentMethod: 'CASH' });
    check('a doctor may NOT take payment', paid.status === 403, `HTTP ${paid.status}`);
    const cancelled = await call(`/invoices/${invA.id}/cancel`, dToken, 'PATCH', { cancelReason: 'x' });
    check('a doctor may NOT cancel an invoice', cancelled.status === 403, `HTTP ${cancelled.status}`);
  }
  {
    const fToken = tokenFor({ ...frontDesk, tenant_id: seed.tenant_id });
    const lined = await call(`/invoices/${invB.id}/lines`, fToken, 'POST', { description: 'Consultation', unitPrice: 30 });
    check('front desk MAY itemise an invoice', lined.status === 201, `HTTP ${lined.status}`);
    const cancelled = await call(`/invoices/${invB.id}/cancel`, fToken, 'PATCH', { cancelReason: 'x' });
    check('front desk may NOT cancel an issued invoice', cancelled.status === 403, `HTTP ${cancelled.status}`);
    const paid = await call(`/invoices/${invB.id}/pay`, fToken, 'PATCH', { paymentMethod: 'CASH' });
    check('front desk MAY take payment', paid.status === 200, `HTTP ${paid.status}`);
  }

  // §10.9 — cross-tenant
  const otherTenant = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    const rows = await tx.$queryRawUnsafe<{ id: string; name: string }[]>(
      `SELECT id, name FROM tenants WHERE id <> '${seed.tenant_id}' LIMIT 1`);
    return rows[0] ?? null;
  });
  if (otherTenant) {
    const foreign = jwt.sign(
      { sub: owner.user_id, tenantId: otherTenant.id, staffId: owner.staff_id, role: owner.role },
      process.env.JWT_ACCESS_SECRET as string, { expiresIn: '30m' });
    const res = await call(`/invoices/${invA.id}/pay`, foreign, 'PATCH', { paymentMethod: 'CASH' });
    check(`a token scoped to "${otherTenant.name}" cannot mutate this invoice`, res.status >= 400, `HTTP ${res.status}`);
  }

  // §10.10-11 — invoice/visit relationship
  const mismatch = await call(`/invoices/${invA.id}/lines`, ownerToken, 'POST', {
    description: 'Injected', unitPrice: 1,
    // A visitId in the body is simply not read: the route resolves the
    // invoice's own visit. Sending one must not redirect the mutation.
    visitId: visitB.id,
  } as never);
  check(
    'a visitId supplied in the body cannot redirect a mutation',
    mismatch.status === 400 || mismatch.status === 201,
    `HTTP ${mismatch.status} (whitelist rejects it, or it is ignored)`,
  );
  const afterMismatch = await api(`/invoices?visitId=${visitB.id}`, ownerToken);
  check(
    'the other visit’s invoice was not touched',
    afterMismatch.every((i: { id: string }) => i.id !== invA.id),
    `${afterMismatch.length} invoice(s) on visit B, none of them A`,
  );
  const unknown = await call('/invoices/00000000-0000-4000-8000-000000000000/pay', ownerToken, 'PATCH', {
    paymentMethod: 'CASH',
  });
  check('a mutation against an unknown invoice fails closed', unknown.status === 404, `HTTP ${unknown.status}`);

  // §10.12 — the authorised workflow still works
  const cancelled = await call(`/invoices/${invA.id}/cancel`, ownerToken, 'PATCH', { cancelReason: 'closure check' });
  check('an authorised owner can still cancel', cancelled.status === 200, `HTTP ${cancelled.status}`);

  // §10.14 — the clinical read is a SEPARATE permission and still works for a
  // role with no billing rights at all.
  const stockRead = await call(`/invoices?visitId=${visitA.id}`, stockToken);
  check(
    'invoice READ is a separate permission from billing mutation',
    stockRead.status === 200,
    `HTTP ${stockRead.status} — STOCK_STAFF may read the summary, mutate nothing`,
  );

  // §10.16-17 — calculations untouched
  const invoiceA = (await api(`/invoices?visitId=${visitA.id}`, ownerToken)).find((i: { id: string }) => i.id === invA.id);
  // RM 40 consultation + the RM 1 line the mismatch test deliberately added to
  // THIS invoice. The total still equals the sum of its own lines — which is
  // also the proof that the injected line landed here and not on visit B.
  const linesTotal = invoiceA.lines.reduce(
    (sum: number, l: { amount: string }) => sum + Number(l.amount), 0);
  check(
    'invoice totals are unchanged by this closure',
    Number(invoiceA.totalAmount) === linesTotal && linesTotal === 41,
    `RM ${invoiceA.totalAmount} = the sum of its ${invoiceA.lines.length} line(s)`,
  );
  {
    const invoiceB = (await api(`/invoices?visitId=${visitB.id}`, ownerToken)).find((i: { id: string }) => i.id === invB.id);
    check(
      'pay behaviour and the panel/patient split are unchanged',
      invoiceB.status === 'PAID' && Number(invoiceB.patientPaidAmount) === 30 && Number(invoiceB.panelCoveredAmount) === 0,
      `${invoiceB.status}, patientPaid=${invoiceB.patientPaidAmount}, panelCovered=${invoiceB.panelCoveredAmount}`,
    );
  }

  // ============================================================== in-browser
  const browser = await chromium.launch({ executablePath: CHROME, headless: false });

  const contextFor = async (token: string, staffId: string, name: string, role: string) => {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    await context.addInitScript(
      (a) => {
        localStorage.setItem('kuwick-auth', JSON.stringify({ state: a, version: 0 }));
        localStorage.setItem('kuwick-record-view-layout', JSON.stringify({ state: { layout: 'canvas' }, version: 0 }));
      },
      {
        accessToken: token,
        refreshToken: token,
        staff: { id: staffId, fullName: name, role, clinicId: null },
        tenant: { id: seed.tenant_id, name: seed.tenant_name, slug: null },
      },
    );
    return context;
  };

  // §10.1 — an authorised billing user
  {
    const context = await contextFor(ownerToken, owner.staff_id, owner.full_name, owner.role);
    const p = await context.newPage();
    await p.goto(`${WEB}/billing/visits/${visitB.id}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(2200);
    const text = (await p.evaluate('document.body.innerText')) as string;
    if (SHOTS) await p.screenshot({ path: join(OUT, 'g3cc-billing-authorised.png') });
    check(
      '[ui] an authorised billing user sees the billing workflow',
      /Billing —/.test(text) && !/do not have access/i.test(text),
      'billing page rendered',
    );
    await context.close();
  }

  // §10.2 — an unauthorised user
  {
    const context = await contextFor(stockToken, stock.staff_id, stock.full_name, stock.role);
    const p = await context.newPage();
    await p.goto(`${WEB}/billing/visits/${visitB.id}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(2200);
    const text = (await p.evaluate('document.body.innerText')) as string;
    if (SHOTS) await p.screenshot({ path: join(OUT, 'g3cc-billing-denied.png') });
    check(
      '[ui] an unauthorised user gets an explained Access Denied, not a silent redirect',
      /do not have access to billing/i.test(text) && /medical record/i.test(text),
      'explained 403 state',
    );
    check(
      '[ui] the unauthorised page mounts no billing controls',
      !/Mark Paid|Quick Add|Add Line|Cancel Invoice/i.test(text),
      'InvoiceTab never mounted',
    );
    // And it never even asked for the money.
    const requested = await p.evaluate(
      `performance.getEntriesByType('resource').filter(function (r) { return r.name.indexOf('/invoices') !== -1; }).length`,
    );
    check(
      '[ui] the unauthorised page did not even request invoice data',
      requested === 0,
      `${requested} invoice request(s)`,
    );
    await context.close();
  }

  // §10.15 — no mutation control returned to the Clinical Workspace
  {
    const context = await contextFor(ownerToken, owner.staff_id, owner.full_name, owner.role);
    const p = await context.newPage();
    await p.goto(`${WEB}/patients/${patients[0].id}?visitId=${visitA.id}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1800);
    await p.getByRole('button', { name: 'Expand all' }).click();
    await p.waitForTimeout(2200);
    await p.evaluate(`(() => {
      var s = Array.prototype.filter.call(document.querySelectorAll('.kw-clinical-section'), function (el) {
        var h = el.querySelector('.kw-section-heading');
        return h && h.innerText.indexOf('Invoice') !== -1;
      })[0];
      if (s) s.scrollIntoView({ block: 'start' });
    })()`);
    await p.waitForTimeout(500);
    const body = (await p.evaluate(`(() => {
      var s = Array.prototype.filter.call(document.querySelectorAll('.kw-clinical-section'), function (el) {
        var h = el.querySelector('.kw-section-heading');
        return h && h.innerText.indexOf('Invoice') !== -1;
      })[0];
      var b = s && s.querySelector('.kw-section-body');
      return b ? b.innerText : '';
    })()`)) as string;
    if (SHOTS) await p.screenshot({ path: join(OUT, 'g3cc-clinical-summary-readonly.png') });
    check(
      '[ui] the Clinical Invoice Summary is still readable and still read-only',
      /Open Full Invoice/.test(body) && !/Mark Paid|Quick Add|Add Line|Cancel Invoice/i.test(body),
      'read-only summary intact',
    );
    await context.close();
  }

  await browser.close();
}

main()
  .then(() => {
    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    if (failed.length > 0) process.exitCode = 1;
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await ledger?.cleanup();
    // Only the staff/users this run created, by id.
    if (fixtureStaffIds.length > 0 || fixtureUserIds.length > 0) {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
          for (const id of fixtureStaffIds) {
            await tx.$executeRawUnsafe(`DELETE FROM staff WHERE id = '${id}'`);
          }
          for (const id of fixtureUserIds) {
            await tx.$executeRawUnsafe(`DELETE FROM users WHERE id = '${id}'`);
          }
        });
      } catch (error) {
        console.warn(`  cleanup: ${(error as Error).message}`);
      }
    }
    await prisma.$disconnect();
  });
