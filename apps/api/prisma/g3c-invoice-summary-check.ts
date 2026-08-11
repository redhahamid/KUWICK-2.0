import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import * as jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { chromium, Page } from 'playwright-core';
import { FixtureLedger, assertFixturesAllowed, fixtureLabel, sweepOrphanedFixtures } from './fixture-support';

config({ path: join(__dirname, '..', '.env') });

// G3c (D-065) — the read-only Clinical Invoice Summary, against the REAL
// database, the REAL HTTP API and real Chrome.
//
//   KUWICK_ALLOW_FIXTURES=yes npx tsx prisma/g3c-invoice-summary-check.ts [--shots]
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const API = 'http://localhost:3000';
const WEB = 'http://localhost:5173';
const SHOTS = process.argv.includes('--shots');
const OUT = join(__dirname, '..', '..', '..', 'docs', 'g3-screenshots');

const VIEWPORTS = [
  { name: '1920x1080', width: 1920, height: 1080, editor: 520 },
  { name: '1366x768', width: 1366, height: 768, editor: 446 },
  { name: 'tablet-900', width: 900, height: 1000, editor: 300 },
  { name: 'mobile-375', width: 375, height: 812, editor: 300 },
];

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
let ledger: FixtureLedger | undefined;

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

async function showInvoice(page: Page) {
  await page.evaluate(`(() => {
    var s = Array.prototype.filter.call(document.querySelectorAll('.kw-clinical-section'), function (el) {
      var h = el.querySelector('.kw-section-heading');
      return h && h.innerText.indexOf('Invoice') !== -1;
    })[0];
    if (s) s.scrollIntoView({ block: 'start' });
  })()`);
  await page.waitForTimeout(500);
}

const MEASURE_JS = `(() => {
  var pm = document.querySelector('.ProseMirror');
  var sections = Array.prototype.slice.call(document.querySelectorAll('.kw-clinical-section'));
  var sec = sections.filter(function (s) {
    var h = s.querySelector('.kw-section-heading');
    return h && h.innerText.indexOf('Invoice') !== -1;
  })[0];
  var heading = sec ? sec.querySelector('.kw-section-heading').innerText.trim() : '';
  var summary = sec ? (sec.querySelector('.kw-section-summary') || {}).innerText || '' : '';
  var body = sec ? sec.querySelector('.kw-section-body') : null;
  var bodyText = body ? body.innerText : '';
  var buttons = body
    ? Array.prototype.map.call(body.querySelectorAll('.ant-btn'), function (b) {
        var r = b.getBoundingClientRect();
        return { label: (b.innerText || b.getAttribute('aria-label') || '').trim(), h: Math.round(r.height) };
      })
    : [];
  var inputs = body ? body.querySelectorAll('input, select, textarea, .ant-select, .ant-input-number').length : 0;
  var scrollers = 0, hoz = [];
  var all = document.querySelectorAll('*');
  for (var i = 0; i < all.length; i++) {
    var el = all[i], cs = getComputedStyle(el), oy = cs.overflowY, ox = cs.overflowX;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 0) scrollers++;
    if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
      scrollers += 100; hoz.push(el.tagName + '.' + (el.className || '').toString().slice(0, 60));
    }
  }
  return {
    editorH: pm ? Math.round(pm.getBoundingClientRect().height) : 0,
    heading: heading, summary: summary, bodyText: bodyText,
    buttons: buttons, inputs: inputs,
    scrollers: scrollers, hoz: hoz,
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1
  };
})()`;

// Anything that would let a doctor move money from the Clinical Workspace.
const FORBIDDEN_CONTROLS = [
  'Mark Paid',
  'Mark as Paid',
  'Quick Add',
  'Add Line',
  'Cancel Invoice',
  'Refund',
  'Create Invoice',
  'Delete',
  'Remove',
];

async function main() {
  assertFixturesAllowed();
  if (SHOTS) mkdirSync(OUT, { recursive: true });

  const seed = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    const r = await tx.$queryRawUnsafe<
      { user_id: string; staff_id: string; tenant_id: string; role: string; full_name: string; tenant_name: string }[]
    >(`
      SELECT u.id AS user_id, s.id AS staff_id, s.tenant_id, s.role, s.full_name, t.name AS tenant_name
      FROM staff s JOIN users u ON s.user_id = u.id JOIN tenants t ON t.id = s.tenant_id
      WHERE s.active AND s.role IN ('DOCTOR_RESIDENT','DOCTOR_LOCUM') LIMIT 1`);
    return r[0];
  });

  const token = jwt.sign(
    { sub: seed.user_id, tenantId: seed.tenant_id, staffId: seed.staff_id, role: seed.role },
    process.env.JWT_ACCESS_SECRET as string,
    { expiresIn: '40m' },
  );

  const swept = await sweepOrphanedFixtures(prisma, seed.tenant_id);
  if (swept > 0) console.log(`Swept ${swept} leftover fixture visit(s)`);
  ledger = new FixtureLedger(prisma, API, token, seed.tenant_id);

  const clinics = await api('/clinics', token);
  const patients = await api('/patients', token);
  const panels = await api('/panel-clinics', token);
  const services = await api('/services', token);
  const items = await api('/items', token);

  const makeVisit = async (label: string, panelClinicId?: string) => {
    const visit = await api('/visits', token, 'POST', {
      clinicId: clinics[0].id,
      patientId: patients[0].id,
      staffId: seed.staff_id,
      billingType: panelClinicId ? 'Panel' : 'Cash',
      panelClinicId,
      presentingComplaint: fixtureLabel(`G3c ${label}`),
    });
    ledger!.visit(visit.id);
    return visit;
  };

  // ---- 1. no invoice ------------------------------------------------------
  const visitNone = await makeVisit('no invoice');

  // ---- 2. cash unpaid, multiple lines incl. medication + procedure --------
  const visitUnpaid = await makeVisit('cash unpaid');
  const invUnpaid = await api('/invoices', token, 'POST', {
    visitId: visitUnpaid.id,
    createdByStaffId: seed.staff_id,
  });
  // A real procedure line, linked to a real order.
  const taskService = services.find((s: { orderType: string }) => s.orderType === 'TASK_ORDER');
  const order = await api('/order-services', token, 'POST', {
    visitId: visitUnpaid.id,
    serviceCatalogId: taskService.id,
  });
  await api(`/invoices/${invUnpaid.id}/lines`, token, 'POST', {
    description: taskService.name,
    unitPrice: 45,
    sourceOrderServiceId: order.id,
  });
  // A real medication line, linked to a real prescription.
  const prescription = await api('/prescriptions', token, 'POST', {
    visitId: visitUnpaid.id,
    itemId: items[0].id,
    quantity: 2,
    amount: 1,
    // frequency and durationDays are required by the prescription DTO — the
    // validation is correct and the fixture was incomplete.
    frequency: 'TDS',
    durationDays: 3,
  });
  await api(`/invoices/${invUnpaid.id}/lines`, token, 'POST', {
    description: items[0].name,
    quantity: 2,
    unitPrice: 12.5,
    sourcePrescriptionId: prescription.id,
  });
  // A freehand line with no source at all.
  await api(`/invoices/${invUnpaid.id}/lines`, token, 'POST', {
    description: 'Consultation',
    unitPrice: 15,
  });

  // ---- 3. cash paid -------------------------------------------------------
  const visitPaid = await makeVisit('cash paid');
  const invPaid = await api('/invoices', token, 'POST', {
    visitId: visitPaid.id,
    createdByStaffId: seed.staff_id,
  });
  await api(`/invoices/${invPaid.id}/lines`, token, 'POST', { description: 'Consultation', unitPrice: 35 });
  await api(`/invoices/${invPaid.id}/pay`, token, 'PATCH', { paymentMethod: 'CASH' });

  // ---- 4. panel invoice ---------------------------------------------------
  const panel = panels[0];
  const visitPanel = panel ? await makeVisit('panel', panel.id) : null;
  let invPanel: { id: string } | null = null;
  if (visitPanel) {
    invPanel = await api('/invoices', token, 'POST', {
      visitId: visitPanel.id,
      createdByStaffId: seed.staff_id,
    });
    await api(`/invoices/${invPanel!.id}/lines`, token, 'POST', { description: 'Consultation', unitPrice: 120 });
  }

  // ---- 5. cancelled -------------------------------------------------------
  const visitCancelled = await makeVisit('cancelled');
  const invCancelled = await api('/invoices', token, 'POST', {
    visitId: visitCancelled.id,
    createdByStaffId: seed.staff_id,
  });
  await api(`/invoices/${invCancelled.id}/lines`, token, 'POST', { description: 'Consultation', unitPrice: 60 });
  await api(`/invoices/${invCancelled.id}/cancel`, token, 'PATCH', { cancelReason: 'Raised on the wrong visit' });

  // ======================================================= API-level checks
  const unpaid = (await api(`/invoices?visitId=${visitUnpaid.id}`, token))[0];
  const paid = (await api(`/invoices?visitId=${visitPaid.id}`, token))[0];
  const cancelled = (await api(`/invoices?visitId=${visitCancelled.id}`, token))[0];

  check(
    'a visit with no invoice returns an empty list, not a zero invoice',
    (await api(`/invoices?visitId=${visitNone.id}`, token)).length === 0,
    '0 invoices',
  );
  check(
    'the backend total is the sum of its lines (45 + 25 + 15 = 85)',
    Number(unpaid.totalAmount) === 85,
    `RM ${unpaid.totalAmount}`,
  );
  check(
    'an unpaid invoice records nothing received',
    Number(unpaid.panelCoveredAmount) === 0 && Number(unpaid.patientPaidAmount) === 0,
    'panelCovered=0, patientPaid=0',
  );
  check(
    'a paid cash invoice snapshots the patient payment',
    paid.status === 'PAID' && Number(paid.patientPaidAmount) === 35,
    `${paid.status}, patientPaid=${paid.patientPaidAmount}`,
  );
  check('a cancelled invoice keeps its reason', cancelled.status === 'CANCELLED' && Boolean(cancelled.cancelReason), cancelled.cancelReason);

  // The read must resolve source relationships — the summary is forbidden
  // from guessing a line's type from its description.
  const medLine = unpaid.lines.find((l: { sourcePrescriptionId: string | null }) => l.sourcePrescriptionId);
  const procLine = unpaid.lines.find((l: { sourceOrderServiceId: string | null }) => l.sourceOrderServiceId);
  const freeLine = unpaid.lines.find(
    (l: { sourcePrescriptionId: string | null; sourceOrderServiceId: string | null }) =>
      !l.sourcePrescriptionId && !l.sourceOrderServiceId,
  );
  check('a medication line resolves its prescription', Boolean(medLine?.sourcePrescription), medLine?.sourcePrescription?.status ?? '-');
  check(
    'a procedure line resolves its order and order type',
    procLine?.sourceOrderService?.orderType === 'TASK_ORDER',
    procLine?.sourceOrderService?.orderType ?? '-',
  );
  check('a freehand line has no fabricated source', Boolean(freeLine) && !freeLine.sourceOrderService && !freeLine.sourcePrescription, 'no source');
  check('the read resolves who raised the invoice', Boolean(unpaid.createdBy?.fullName), unpaid.createdBy?.fullName ?? '-');
  if (visitPanel) {
    const panelInvoice = (await api(`/invoices?visitId=${visitPanel.id}`, token))[0];
    check(
      'a panel invoice resolves the panel name from the visit',
      Boolean(panelInvoice.visit?.panelClinic?.name),
      panelInvoice.visit?.panelClinic?.name ?? '-',
    );
  }

  // ============================================================== §12 security
  const otherTenant = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    const rows = await tx.$queryRawUnsafe<{ id: string; name: string }[]>(
      `SELECT id, name FROM tenants WHERE id <> '${seed.tenant_id}' LIMIT 1`,
    );
    return rows[0] ?? null;
  });
  if (otherTenant) {
    const foreign = jwt.sign(
      { sub: seed.user_id, tenantId: otherTenant.id, staffId: seed.staff_id, role: seed.role },
      process.env.JWT_ACCESS_SECRET as string,
      { expiresIn: '30m' },
    );
    const cross = await call(`/invoices?visitId=${visitUnpaid.id}`, foreign);
    check(
      `a token scoped to "${otherTenant.name}" cannot read this visit's invoices`,
      cross.status >= 400 || (Array.isArray(cross.body) && cross.body.length === 0),
      `HTTP ${cross.status}, ${Array.isArray(cross.body) ? cross.body.length : '-'} row(s)`,
    );
  }

  // Direct endpoint access — not relying on the UI hiding anything.
  const noAuth = await fetch(`${API}/invoices?visitId=${visitUnpaid.id}`);
  check('the invoice read requires authentication', noAuth.status === 401, `HTTP ${noAuth.status}`);

  // An invoice id that belongs to a different visit must not surface under
  // this visit's read.
  const wrongVisit = await api(`/invoices?visitId=${visitPaid.id}`, token);
  check(
    'a visit read never returns another visit’s invoice',
    wrongVisit.every((i: { visitId: string }) => i.visitId === visitPaid.id),
    `${wrongVisit.length} row(s), all for this visit`,
  );

  // Branch enforcement: a staff member whose home branch is elsewhere in a
  // multi-branch tenant must be refused.
  const branchProbe = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    const branches = await tx.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM clinics WHERE tenant_id = '${seed.tenant_id}'`,
    );
    const other = await tx.$queryRawUnsafe<{ user_id: string; staff_id: string; role: string; clinic_id: string }[]>(`
      SELECT u.id AS user_id, s.id AS staff_id, s.role, s.clinic_id
      FROM staff s JOIN users u ON s.user_id = u.id
      WHERE s.active AND s.tenant_id = '${seed.tenant_id}'
        AND s.clinic_id IS NOT NULL AND s.clinic_id <> '${clinics[0].id}' LIMIT 1`);
    return { branchCount: branches[0].n, other: other[0] ?? null };
  });
  if (branchProbe.branchCount > 1 && branchProbe.other) {
    const otherBranchToken = jwt.sign(
      {
        sub: branchProbe.other.user_id,
        tenantId: seed.tenant_id,
        staffId: branchProbe.other.staff_id,
        role: branchProbe.other.role,
      },
      process.env.JWT_ACCESS_SECRET as string,
      { expiresIn: '30m' },
    );
    const denied = await call(`/invoices?visitId=${visitUnpaid.id}`, otherBranchToken);
    check(
      'a staff member from another branch cannot read this visit’s invoices',
      denied.status === 403,
      `HTTP ${denied.status}`,
    );
  } else {
    console.log(
      `SKIP  cross-branch — tenant has ${branchProbe.branchCount} branch(es)${branchProbe.other ? '' : ' and no staff homed elsewhere'}`,
    );
  }

  // ================================================================ in-browser
  const browser = await chromium.launch({ executablePath: CHROME, headless: false });

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    await context.addInitScript(
      (a) => {
        localStorage.setItem('kuwick-auth', JSON.stringify({ state: a, version: 0 }));
        localStorage.setItem('kuwick-record-view-layout', JSON.stringify({ state: { layout: 'canvas' }, version: 0 }));
      },
      {
        accessToken: token,
        refreshToken: token,
        staff: { id: seed.staff_id, fullName: seed.full_name, role: seed.role, clinicId: null },
        tenant: { id: seed.tenant_id, name: seed.tenant_name, slug: null },
      },
    );

    const open = async (visitId: string) => {
      const p = await context.newPage();
      await p.goto(`${WEB}/patients/${patients[0].id}?visitId=${visitId}`, { waitUntil: 'networkidle' });
      await p.waitForTimeout(1600);
      await p.getByRole('button', { name: 'Expand all' }).click();
      await p.waitForTimeout(2200);
      await showInvoice(p);
      return p;
    };

    // --- unpaid cash, the main scenario ---
    {
      const p = await open(visitUnpaid.id);
      const m = (await p.evaluate(MEASURE_JS)) as any;
      if (SHOTS) await p.screenshot({ path: join(OUT, `g3c-cash-unpaid-${vp.name}.png`) });

      check(`[${vp.name}] editor height unchanged from G0/G1`, Math.abs(m.editorH - vp.editor) <= 2, `${m.editorH}px`);
      check(`[${vp.name}] no horizontal page overflow`, !m.horizontalOverflow, 'invoice expanded');
      check(
        `[${vp.name}] one natural page scroll — no nested or sideways scrollers`,
        m.scrollers <= 1,
        m.scrollers >= 100 ? `HORIZONTAL: ${m.hoz.join(' | ')}` : `${m.scrollers} scroller(s)`,
      );

      check(
        `[${vp.name}] the collapsed line names the invoice, amount, status and billing type`,
        /Invoice INV-/.test(m.summary) && /RM 85\.00/.test(m.summary) && /Unpaid/.test(m.summary) && /Cash/.test(m.summary),
        `"${m.summary}"`,
      );
      check(
        `[${vp.name}] the expanded total and outstanding match the backend`,
        /Total\s*RM 85\.00/.test(m.bodyText.replace(/\n/g, ' ')) &&
          /Outstanding\s*RM 85\.00/.test(m.bodyText.replace(/\n/g, ' ')),
        'RM 85.00 total, RM 85.00 outstanding',
      );
      check(
        `[${vp.name}] line sources are labelled from the stored relationship`,
        /Medication/.test(m.bodyText) && /Procedure/.test(m.bodyText),
        'Medication + Procedure tags present',
      );
      check(
        `[${vp.name}] no tax or discount line is invented`,
        !/SST|Tax|Discount/i.test(m.bodyText),
        'the schema stores none, so none is shown',
      );

      // §2 — the whole point.
      const labels: string[] = m.buttons.map((b: any) => b.label);
      const offending = labels.filter((l) => FORBIDDEN_CONTROLS.some((f) => l.toLowerCase().includes(f.toLowerCase())));
      check(
        `[${vp.name}] no financial mutation control is present`,
        offending.length === 0,
        offending.length ? `FOUND: ${offending.join(', ')}` : `only: ${[...new Set(labels)].join(', ')}`,
      );
      check(
        `[${vp.name}] the summary has no editable field`,
        m.inputs === 0,
        `${m.inputs} input(s) in the invoice section`,
      );
      check(
        `[${vp.name}] Open Full Invoice is offered`,
        labels.some((l) => /Open Full Invoice/.test(l)),
        'link to the billing workflow present',
      );
      if (vp.width < 768) {
        const small = m.buttons.filter((b: any) => b.h > 0 && b.h < 44).map((b: any) => `${b.label}:${b.h}px`);
        check(`[${vp.name}] action targets are at least 44px tall`, small.length === 0, small.join(', ') || 'all >= 44px');
      }
      await p.close();
    }

    // --- no invoice ---
    {
      const p = await open(visitNone.id);
      const m = (await p.evaluate(MEASURE_JS)) as any;
      if (SHOTS) await p.screenshot({ path: join(OUT, `g3c-no-invoice-${vp.name}.png`) });
      check(
        `[${vp.name}] a visit with no invoice says so, and shows no RM 0.00`,
        /No invoice has been created for this visit/.test(m.bodyText) && !/RM 0\.00/.test(m.bodyText),
        'clear empty state',
      );
      check(
        `[${vp.name}] the empty state offers no Create Invoice control`,
        !m.buttons.some((b: any) => /create invoice/i.test(b.label)),
        'creation lives in billing',
      );
      await p.close();
    }

    // --- paid ---
    {
      const p = await open(visitPaid.id);
      const m = (await p.evaluate(MEASURE_JS)) as any;
      if (SHOTS) await p.screenshot({ path: join(OUT, `g3c-cash-paid-${vp.name}.png`) });
      check(
        `[${vp.name}] a paid invoice shows Paid with nothing outstanding`,
        /Paid/.test(m.summary) && /Outstanding\s*RM 0\.00/.test(m.bodyText.replace(/\n/g, ' ')),
        'paid, RM 0.00 outstanding',
      );
      await p.close();
    }

    // --- panel ---
    if (visitPanel) {
      const p = await open(visitPanel.id);
      const m = (await p.evaluate(MEASURE_JS)) as any;
      if (SHOTS) await p.screenshot({ path: join(OUT, `g3c-panel-${vp.name}.png`) });
      check(
        `[${vp.name}] a panel invoice names the panel`,
        /Panel/.test(m.summary) && m.summary.includes(panel.name),
        `"${m.summary}"`,
      );
      check(
        `[${vp.name}] an unpaid panel invoice claims no panel-covered figure`,
        !/Panel covered/.test(m.bodyText),
        'split withheld until pay time records it',
      );
      await p.close();
    }

    // --- cancelled ---
    {
      const p = await open(visitCancelled.id);
      const m = (await p.evaluate(MEASURE_JS)) as any;
      if (SHOTS) await p.screenshot({ path: join(OUT, `g3c-cancelled-${vp.name}.png`) });
      check(
        `[${vp.name}] a cancelled invoice is labelled and owes nothing`,
        /Cancelled/.test(m.summary) && /Outstanding\s*RM 0\.00/.test(m.bodyText.replace(/\n/g, ' ')),
        'cancelled, RM 0.00 outstanding',
      );
      await p.close();
    }

    await context.close();
  }

  // --- Open Full Invoice reaches the billing page, at one viewport --------
  {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    await context.addInitScript(
      (a) => {
        localStorage.setItem('kuwick-auth', JSON.stringify({ state: a, version: 0 }));
        localStorage.setItem('kuwick-record-view-layout', JSON.stringify({ state: { layout: 'canvas' }, version: 0 }));
      },
      {
        accessToken: token,
        refreshToken: token,
        staff: { id: seed.staff_id, fullName: seed.full_name, role: seed.role, clinicId: null },
        tenant: { id: seed.tenant_id, name: seed.tenant_name, slug: null },
      },
    );
    const p = await context.newPage();
    await p.goto(`${WEB}/billing/visits/${visitUnpaid.id}?invoiceId=${invUnpaid.id}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(2200);
    const text = (await p.evaluate('document.body.innerText')) as string;
    if (SHOTS) await p.screenshot({ path: join(OUT, 'g3c-billing-page.png') });
    check(
      'Open Full Invoice reaches the billing workflow with the visit in context',
      /Billing —/.test(text) && text.includes(invUnpaid.invoiceNumber),
      'billing page shows this visit’s invoice',
    );
    check(
      'the billing workflow still offers the financial actions',
      /Mark Paid|Quick Add|Add Line|Cancel/i.test(text),
      'mutation preserved where it belongs',
    );

    const invoicesAfter = await api(`/invoices?visitId=${visitUnpaid.id}`, token);
    check(
      'opening the billing page created no second invoice',
      invoicesAfter.length === 1,
      `${invoicesAfter.length} invoice on the visit`,
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
    await prisma.$disconnect();
  });
