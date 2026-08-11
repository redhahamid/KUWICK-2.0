import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import * as jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { chromium, Page } from 'playwright-core';
import { FixtureLedger, assertFixturesAllowed, fixtureLabel, sweepOrphanedFixtures } from './fixture-support';

config({ path: join(__dirname, '..', '.env') });

// G1 (D-058) — verify the unified clinical section structure against a
// REALISTICALLY POPULATED record, not an empty one. The whole point of the
// change is how it behaves when a visit actually has content, and C2's
// original numbers were taken on an empty visit.
//
//   KUWICK_ALLOW_FIXTURES=yes npx tsx prisma/g1-section-stack-check.ts [--shots]
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const API = 'http://localhost:3000';
const WEB = 'http://localhost:5173';
const SHOTS = process.argv.includes('--shots');
const OUT = join(__dirname, '..', '..', '..', 'docs', 'g1-screenshots');

const VIEWPORTS = [
  { name: '1920x1080', width: 1920, height: 1080, expectEditor: 520, mode: 'fill' },
  { name: '1366x768', width: 1366, height: 768, expectEditor: 446, mode: 'fill' },
  { name: 'tablet-900', width: 900, height: 1000, expectEditor: 300, mode: 'min' },
  { name: 'mobile-375', width: 375, height: 812, expectEditor: 300, mode: 'min' },
];

const SECTION_ORDER = ['Diagnosis', 'Orders / Procedures', 'Medications', 'Documents', 'Invoice'];

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
let ledger: FixtureLedger | undefined;

const results: { name: string; pass: boolean; detail: string }[] = [];
function check(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

async function api(path: string, token: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const MEASURE_JS = `(() => {
  var pm = document.querySelector('.ProseMirror');
  var fill = document.querySelector('.kw-editor-fill');
  var sections = Array.prototype.map.call(
    document.querySelectorAll('.kw-clinical-section'),
    function (el) {
      var head = el.querySelector('.kw-section-heading');
      var sum = el.querySelector('.kw-section-summary');
      var act = el.querySelector('.kw-section-action');
      var r = el.getBoundingClientRect();
      var actRect = act ? act.getBoundingClientRect() : null;
      return {
        heading: head ? head.innerText.trim() : '',
        summary: sum ? sum.innerText.trim() : '',
        action: act ? act.innerText.trim() : '',
        actionH: actRect ? Math.round(actRect.height) : 0,
        actionW: actRect ? Math.round(actRect.width) : 0,
        width: Math.round(r.width),
        expanded: head ? head.parentElement.getAttribute('aria-expanded') === 'true' : false
      };
    }
  );
  var scrollers = 0;
  var all = document.querySelectorAll('*');
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var cs = getComputedStyle(el);
    var oy = cs.overflowY;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 0) scrollers++;
  }
  return {
    editorH: pm ? Math.round(pm.getBoundingClientRect().height) : 0,
    mode: fill ? 'fill' : 'min',
    sections: sections,
    scrollers: scrollers,
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    mainWidth: (function () {
      var m = document.querySelector('.kw-canvas-main');
      return m ? Math.round(m.getBoundingClientRect().width) : 0;
    })()
  };
})()`;

async function main() {
  assertFixturesAllowed();
  if (SHOTS) mkdirSync(OUT, { recursive: true });

  const seed = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    const rows = await tx.$queryRawUnsafe<
      { user_id: string; staff_id: string; tenant_id: string; role: string; full_name: string; tenant_name: string }[]
    >(`
      SELECT u.id AS user_id, s.id AS staff_id, s.tenant_id, s.role, s.full_name, t.name AS tenant_name
      FROM staff s JOIN users u ON s.user_id = u.id JOIN tenants t ON t.id = s.tenant_id
      WHERE s.active AND s.role IN ('DOCTOR_RESIDENT','DOCTOR_LOCUM') LIMIT 1
    `);
    if (rows.length === 0) throw new Error('No active doctor with a user account found');
    return rows[0];
  });

  const token = jwt.sign(
    { sub: seed.user_id, tenantId: seed.tenant_id, staffId: seed.staff_id, role: seed.role },
    process.env.JWT_ACCESS_SECRET as string,
    { expiresIn: '40m' },
  );

  const swept = await sweepOrphanedFixtures(prisma, seed.tenant_id);
  if (swept > 0) console.log(`Swept ${swept} leftover fixture visit(s)`);
  ledger = new FixtureLedger(prisma, API, token, seed.tenant_id);

  const patients = await api('/patients', token);
  const patient = patients[0];
  const clinics = await api('/clinics', token);

  const mkVisit = async (complaint: string) => {
    const visit = await api('/visits', token, 'POST', {
      clinicId: clinics[0].id,
      patientId: patient.id,
      staffId: seed.staff_id,
      billingType: 'Cash',
      presentingComplaint: fixtureLabel(complaint),
    });
    ledger!.visit(visit.id);
    return visit;
  };

  const emptyVisit = await mkVisit('G0 g1 empty control');
  const visit = await mkVisit('G0 g1 populated record');

  // ---- 4 diagnoses ----
  const catalog = await api('/diagnosis-catalog?search=a&category=SUMMARIZE', token);
  for (const entry of catalog.slice(0, 4)) {
    await api('/diagnoses', token, 'POST', { visitId: visit.id, diagnosisCatalogId: entry.id });
  }

  // ---- 3 orders, three DIFFERENT statuses ----
  const services = await api('/services', token);
  const orderA = await api('/order-services', token, 'POST', { visitId: visit.id, serviceCatalogId: services[0].id });
  const orderB = await api('/order-services', token, 'POST', { visitId: visit.id, serviceCatalogId: services[1].id });
  const orderC = await api('/order-services', token, 'POST', { visitId: visit.id, serviceCatalogId: services[2].id });
  await api(`/order-services/${orderB.id}/start`, token, 'PATCH', {});
  await api(`/order-services/${orderC.id}/start`, token, 'PATCH', {});
  await api(`/order-services/${orderC.id}/complete`, token, 'PATCH', { result: 'Normal study.' });
  void orderA;

  // ---- 5 medications ----
  const items = await api('/items', token);
  for (const item of items.slice(0, 5)) {
    await api('/prescriptions', token, 'POST', {
      visitId: visit.id,
      itemId: item.id,
      quantity: 1,
      amount: 5,
      unit: 'ml',
      frequency: 'TDS',
      durationDays: 5,
    });
  }

  // ---- multiple documents ----
  for (const [type, content] of [
    ['MC', 'Medical certificate for two days rest.'],
    ['REFERRAL', 'Referral to ENT clinic.'],
    ['MEMO', 'Memo to employer.'],
  ] as const) {
    await api('/documents', token, 'POST', {
      visitId: visit.id,
      type,
      content,
      issuedByStaffId: seed.staff_id,
      issuedDate: new Date().toISOString().slice(0, 10),
    });
  }

  // ---- invoice with lines ----
  const invoice = await api('/invoices', token, 'POST', { visitId: visit.id, createdByStaffId: seed.staff_id });
  await api(`/invoices/${invoice.id}/lines`, token, 'POST', {
    description: 'Consultation Fee',
    quantity: 1,
    unitPrice: 45,
  });
  await api(`/invoices/${invoice.id}/lines`, token, 'POST', {
    description: 'Dressing Set',
    quantity: 2,
    unitPrice: 20,
  });

  const counts = {
    dx: (await api(`/diagnoses?visitId=${visit.id}`, token)).length,
    orders: (await api(`/order-services?visitId=${visit.id}`, token)).length,
    meds: (await api(`/prescriptions?visitId=${visit.id}`, token)).length,
    docs: (await api(`/documents?visitId=${visit.id}`, token)).length,
    invoices: (await api(`/invoices?visitId=${visit.id}`, token)).length,
  };
  console.log('Populated:', counts);
  check(
    'record meets the required population',
    counts.dx >= 4 && counts.orders >= 3 && counts.meds >= 5 && counts.docs >= 3 && counts.invoices >= 1,
    `${counts.dx} dx / ${counts.orders} orders / ${counts.meds} meds / ${counts.docs} docs / ${counts.invoices} invoice`,
  );

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
    const page: Page = await context.newPage();

    const open = async (visitId: string) => {
      await page.goto(`${WEB}/patients/${patient.id}?visitId=${visitId}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1800);
      return (await page.evaluate(MEASURE_JS)) as any;
    };

    const empty = await open(emptyVisit.id);
    const full = await open(visit.id);

    // Re-read per viewport: the 1920 pass exercises "add a diagnosis", so the
    // count legitimately differs afterwards. Comparing against a snapshot
    // taken before that add reported the app wrong when the test was.
    const liveDx = (await api(`/diagnoses?visitId=${visit.id}`, token)).length;
    if (SHOTS) {
      // Two collapsed shots: the viewport as the doctor first sees it (note
      // dominant, sections below the fold — the intent, not a defect), and the
      // section stack scrolled into view so the collapsed summaries are
      // actually legible in review.
      await page.screenshot({ path: join(OUT, `g1-collapsed-${vp.name}.png`) });
      await page.locator('.kw-section-stack').scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(OUT, `g1-sections-${vp.name}.png`) });
      await page.evaluate('window.scrollTo(0, 0)');
      await page.waitForTimeout(400);
    }

    // 1 & 2 — editor height unchanged, and unchanged BY population.
    check(
      `[${vp.name}] editor is the accepted G0 height`,
      Math.abs(full.editorH - vp.expectEditor) <= 2 && full.mode === vp.mode,
      `${full.editorH}px (${full.mode}), expected ~${vp.expectEditor}px`,
    );
    check(
      `[${vp.name}] section content does not reduce editor height`,
      full.editorH === empty.editorH,
      `empty ${empty.editorH}px vs populated ${full.editorH}px`,
    );

    // 3 & 9 — five separate sections, in clinical order, Documents ≠ Invoice.
    // The heading block also contains the status tag on its own line
    // ("Orders / Procedures (3)\n2 awaiting result"), so take the first line
    // before stripping the count — an end-anchored regex alone silently
    // failed to strip it and reported correct sections as out of order.
    const headings = full.sections.map((s: any) =>
      s.heading.split('\n')[0].replace(/\s*\(\d+\)\s*$/, '').trim(),
    );
    check(
      `[${vp.name}] five sections in clinical order`,
      JSON.stringify(headings) === JSON.stringify(SECTION_ORDER),
      headings.join(' → '),
    );

    // 4 — counts and summaries reflect real data.
    const dxSection = full.sections[0];
    const ordSection = full.sections[1];
    const medSection = full.sections[2];
    const docSection = full.sections[3];
    const invSection = full.sections[4];
    check(
      `[${vp.name}] Diagnosis count and "+N more" are accurate`,
      dxSection.heading.includes(`(${liveDx})`) && dxSection.summary.includes(`+${liveDx - 3} more`),
      `${liveDx} in the record — ${dxSection.heading} — "${dxSection.summary}"`,
    );
    check(
      `[${vp.name}] Orders summary reports the real status mix`,
      ordSection.summary.includes('Ordered') &&
        ordSection.summary.includes('In Progress') &&
        ordSection.summary.includes('Completed'),
      `"${ordSection.summary}"`,
    );
    check(
      `[${vp.name}] Medications count and "+N more" are accurate`,
      medSection.heading.includes(`(${counts.meds})`) && medSection.summary.includes(`+${counts.meds - 3} more`),
      `${medSection.heading} — "${medSection.summary}"`,
    );
    check(
      `[${vp.name}] Documents summarises by real stored type`,
      docSection.heading.includes(`(${counts.docs})`) && /MC|Referral|Memo/.test(docSection.summary),
      `${docSection.heading} — "${docSection.summary}"`,
    );
    check(
      `[${vp.name}] Invoice shows total and payment status`,
      invSection.summary.includes('RM 85.00') && invSection.action === 'Open Invoice',
      `"${invSection.summary}" [${invSection.action}]`,
    );

    // Full width, no grid.
    const widths: number[] = full.sections.map((s: any) => s.width);
    check(
      `[${vp.name}] sections are full width, not a card grid`,
      new Set(widths).size === 1 && widths[0] >= full.mainWidth,
      `all ${widths[0]}px`,
    );

    check(`[${vp.name}] no horizontal overflow`, !full.horizontalOverflow, 'populated record');

    // Mobile touch targets.
    if (vp.width < 768) {
      const actionHeights: number[] = full.sections.map((s: any) => s.actionH);
      check(
        `[${vp.name}] primary actions meet the 44px touch target`,
        actionHeights.every((h) => h >= 44),
        `heights ${actionHeights.join(', ')}px`,
      );
      // Claimed in the CSS and therefore worth asserting: one wide primary
      // action per section, not a content-sized button floating in the row.
      const actionWidths: number[] = full.sections.map((s: any) => s.actionW);
      check(
        `[${vp.name}] the primary action spans the section, not a small button`,
        actionWidths.every((w) => w >= full.sections[0].width * 0.6),
        `widths ${actionWidths.join(', ')}px in a ${full.sections[0].width}px section`,
      );
    }

    // 5 — expand everything: no nested scroll trap.
    await page.getByRole('button', { name: 'Expand all' }).click();
    await page.waitForTimeout(2500);
    const expanded = (await page.evaluate(MEASURE_JS)) as any;
    if (SHOTS) await page.screenshot({ path: join(OUT, `g1-expanded-${vp.name}.png`), fullPage: true });
    check(
      `[${vp.name}] every section expands`,
      expanded.sections.every((s: any) => s.expanded),
      `${expanded.sections.filter((s: any) => s.expanded).length}/5 expanded`,
    );
    check(
      `[${vp.name}] expanding creates no nested scroll trap`,
      expanded.scrollers <= 1,
      `${expanded.scrollers} scrolling container(s)`,
    );
    check(
      `[${vp.name}] editor height survives expanding every section`,
      expanded.editorH === full.editorH,
      `${expanded.editorH}px`,
    );
    check(`[${vp.name}] no horizontal overflow when expanded`, !expanded.horizontalOverflow, 'all sections open');

    // 6 — the existing actions still work: add a diagnosis through the
    // expanded section and confirm the count moves.
    if (vp.name === '1920x1080') {
      const before = (await api(`/diagnoses?visitId=${visit.id}`, token)).length;
      // antd renders the placeholder as a div behind the real combobox input,
      // so getByPlaceholder never resolves (the same trap that cost a run in
      // the G0 consumer check). Target the input inside that control.
      const searchBox = page
        .locator('.ant-select')
        .filter({ hasText: 'Type to search diagnoses...' })
        .first()
        .locator('input.ant-select-input');
      await searchBox.click();
      await searchBox.fill('fever');
      await page.waitForTimeout(1800);
      const option = page.locator('.ant-select-item-option').first();
      if ((await option.count()) > 0) {
        await option.click();
        await page.waitForTimeout(1500);
      }
      const after = (await api(`/diagnoses?visitId=${visit.id}`, token)).length;
      check(
        '[actions] adding a diagnosis through the expanded section still works',
        after === before + 1,
        `${before} → ${after}`,
      );
      const reread = (await page.evaluate(MEASURE_JS)) as any;
      check(
        '[actions] the section count updates after the add',
        reread.sections[0].heading.includes(`(${after})`),
        reread.sections[0].heading,
      );
    }

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
