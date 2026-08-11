import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import * as jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { chromium, Page } from 'playwright-core';
import { FixtureLedger, assertFixturesAllowed, fixtureLabel, sweepOrphanedFixtures } from './fixture-support';

config({ path: join(__dirname, '..', '.env') });

// G0a (D-054) — prove the two defects are actually fixed, in real Chrome.
//
//   A. A visit with ZERO notes opens a usable editor immediately, with one
//      local draft and NO database row until the doctor saves.
//   B. The editor's height is POPULATION-INDEPENDENT. C2 measured 324px on a
//      completely empty record; the whole point of this check is that adding
//      diagnoses, orders and medications must not change it.
//
// Reads the DB only to pick a real doctor and to count note rows. It mints an
// access token with the server's own secret rather than resetting anyone's
// password, so no credential is changed to run a test.
//
//   npx tsx prisma/g0a-editor-check.ts [--shots]
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const API = 'http://localhost:3000';
const WEB = 'http://localhost:5173';
const SHOTS = process.argv.includes('--shots');
const OUT = join(__dirname, '..', '..', '..', 'docs', 'g0-screenshots');

const VIEWPORTS = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: 'tablet-900', width: 900, height: 1000 },
  { name: 'mobile-375', width: 375, height: 812 },
];

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
// Assigned once the session exists; cleaned up in the finally block below
// whether the run passes, fails or throws.
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

// Measured as a source string: tsx/esbuild rewrites nested arrow functions
// with a `__name` helper that does not exist in the page.
const MEASURE_JS = `(() => {
  var pm = document.querySelector('.ProseMirror');
  var pmRect = pm ? pm.getBoundingClientRect() : null;
  var fillWrap = document.querySelector('.kw-editor-fill');
  var minWrap = document.querySelector('.kw-editor-min');
  var canvas = document.querySelector('.kw-canvas-shell');
  var scrollers = 0;
  var all = document.querySelectorAll('*');
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var cs = getComputedStyle(el);
    var oy = cs.overflowY;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 0) {
      scrollers++;
    }
  }
  return {
    editorH: pmRect ? Math.round(pmRect.height) : 0,
    editorW: pmRect ? Math.round(pmRect.width) : 0,
    editable: pm ? pm.getAttribute('contenteditable') === 'true' : false,
    mode: fillWrap ? 'fill' : minWrap ? 'min' : 'none',
    // Report the COMPUTED values so the height rule is evidence, not a claim.
    computed: pm
      ? (function () {
          var cs = getComputedStyle(pm);
          return { height: cs.height, minHeight: cs.minHeight, overflowY: cs.overflowY };
        })()
      : null,
    inCanvas: !!canvas,
    lowerSections: document.querySelectorAll('.kw-canvas-main .ant-card').length,
    scrollers: scrollers,
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    bodyText: document.body.innerText
  };
})()`;

async function openVisit(page: Page, patientId: string, visitId: string) {
  await page.goto(`${WEB}/patients/${patientId}?visitId=${visitId}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
}

async function main() {
  assertFixturesAllowed();
  if (SHOTS) mkdirSync(OUT, { recursive: true });

  // --- pick a real doctor, read-only -------------------------------------
  // `staff`/`users` are FORCE ROW LEVEL SECURITY, so a query without the
  // bypass GUC set returns zero rows rather than erroring (D-048).
  //
  // Deliberately NOT filtered on clinic_id: the doctors in this dataset have
  // no home branch (the same C0 preflight finding), and C0's hasBranchAccess
  // auto-resolves a single-clinic tenant. Filtering on it found nobody and
  // would have made this look like "no doctors exist".
  const seed = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    const rows = await tx.$queryRawUnsafe<
      { user_id: string; staff_id: string; tenant_id: string; role: string; full_name: string; tenant_name: string }[]
    >(`
      SELECT u.id AS user_id, s.id AS staff_id, s.tenant_id, s.role, s.full_name, t.name AS tenant_name
      FROM staff s
      JOIN users u ON s.user_id = u.id
      JOIN tenants t ON t.id = s.tenant_id
      WHERE s.active AND s.role IN ('DOCTOR_RESIDENT','DOCTOR_LOCUM')
      LIMIT 1
    `);
    if (rows.length === 0) throw new Error('No active doctor with a user account found');
    return rows[0];
  });
  console.log(`Acting as ${seed.full_name} (${seed.role})`);

  const token = jwt.sign(
    { sub: seed.user_id, tenantId: seed.tenant_id, staffId: seed.staff_id, role: seed.role },
    process.env.JWT_ACCESS_SECRET as string,
    { expiresIn: '30m' },
  );

  // --- two fresh visits: one left empty, one populated --------------------
  const patients = await api(`/patients`, token);
  const patient = patients[0];
  if (!patient) throw new Error('No patient in this tenant');
  const clinics = await api('/clinics', token);
  const clinicId: string = clinics[0].id;

  // Anything an interrupted earlier run left behind goes first, so a long
  // history of test runs cannot silently pile up in the dev database.
  const swept = await sweepOrphanedFixtures(prisma, seed.tenant_id);
  if (swept > 0) console.log(`Swept ${swept} leftover fixture visit(s) from previous runs`);

  ledger = new FixtureLedger(prisma, API, token, seed.tenant_id);

  const mkVisit = async (complaint: string) => {
    const visit = await api('/visits', token, 'POST', {
      clinicId,
      patientId: patient.id,
      staffId: seed.staff_id,
      billingType: 'Cash',
      presentingComplaint: fixtureLabel(complaint),
    });
    ledger!.visit(visit.id);
    return visit;
  };

  const emptyVisit = await mkVisit('G0a zero-note check');
  const fullVisit = await mkVisit('G0a populated check');

  // Populate the second visit with realistic clinical content.
  const catalog = await api(`/diagnosis-catalog?search=a&category=SUMMARIZE`, token);
  for (const entry of catalog.slice(0, 4)) {
    await api('/diagnoses', token, 'POST', { visitId: fullVisit.id, diagnosisCatalogId: entry.id });
  }
  const services = await api('/services', token);
  for (const service of services.slice(0, 3)) {
    await api('/order-services', token, 'POST', { visitId: fullVisit.id, serviceCatalogId: service.id });
  }
  const items = await api('/items', token);
  for (const item of items.slice(0, 5)) {
    await api('/prescriptions', token, 'POST', {
      visitId: fullVisit.id,
      itemId: item.id,
      quantity: 1,
      amount: 5,
      unit: 'ml',
      frequency: 'TDS',
      durationDays: 5,
    });
  }
  const dxCount = (await api(`/diagnoses?visitId=${fullVisit.id}`, token)).length;
  const orderCount = (await api(`/order-services?visitId=${fullVisit.id}`, token)).length;
  const medCount = (await api(`/prescriptions?visitId=${fullVisit.id}`, token)).length;
  console.log(`Populated visit: ${dxCount} diagnoses, ${orderCount} orders, ${medCount} medications`);
  check(
    'populated visit really has content',
    dxCount > 0 && orderCount > 0 && medCount > 0,
    `${dxCount} dx / ${orderCount} orders / ${medCount} meds`,
  );

  // A third visit carrying a SIGNED note, so the read-only path is exercised
  // with a real signature rather than assumed to still work.
  const signedVisit = await mkVisit('G0a signed-note check');
  const signedNote = await api(`/visits/${signedVisit.id}/clinical-notes`, token, 'POST', {
    notes: '<p>Signed note for the G0a read-only check.</p>',
    noteLanguage: 'EN',
    noteType: 'DOCTOR_NARRATIVE',
  });
  await api(`/visits/${signedVisit.id}/clinical-notes/${signedNote.id}/sign`, token, 'POST', {
    expectedVersion: signedNote.version,
  });

  // A legacy note (authorship predates C0) can only be found, never created —
  // C0 forbids manufacturing one. Skip the check honestly if none exists.
  const legacy = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${seed.tenant_id}, true)`;
    const rows = await tx.$queryRawUnsafe<{ visit_id: string; patient_id: string }[]>(`
      SELECT n.visit_id, v.patient_id FROM clinical_notes n
      JOIN visits v ON v.id = n.visit_id
      WHERE n.legacy_author_unknown = true LIMIT 1
    `);
    return rows[0] ?? null;
  });

  const browser = await chromium.launch({ executablePath: CHROME, headless: false });

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await context.newPage();
    await page.goto(WEB);
    await page.evaluate(
      (payload: string) => localStorage.setItem('kuwick-auth', payload),
      JSON.stringify({
        state: {
          accessToken: token,
          refreshToken: token,
          staff: { id: seed.staff_id, fullName: seed.full_name, role: seed.role, clinicId: null },
          tenant: { id: seed.tenant_id, name: seed.tenant_name, slug: null },
        },
        version: 0,
      }),
    );
    // The layout store defaults to 'flow'. A first run without this line
    // measured Flow at every viewport and reported 22/22 — meaningless, since
    // Flow shows one section at a time and never renders the lower sections
    // whose growth is the entire thing being tested. Force Canvas.
    await page.evaluate((payload: string) => localStorage.setItem('kuwick-record-view-layout', payload),
      JSON.stringify({ state: { layout: 'canvas' }, version: 0 }));

    // ---- zero-note visit ----
    await openVisit(page, patient.id, emptyVisit.id);
    const empty = (await page.evaluate(MEASURE_JS)) as any;
    if (SHOTS) await page.screenshot({ path: join(OUT, `g0a-zero-note-${vp.name}.png`), fullPage: false });

    // Guard against the false pass above: assert we are actually in Canvas,
    // and that desktop really selected the fill height rather than silently
    // falling back to the tablet/mobile minimum.
    const expectedMode = vp.width >= 992 ? 'fill' : 'min';
    check(
      `[${vp.name}] measuring the Canvas layout in ${expectedMode} mode`,
      empty.inCanvas && empty.mode === expectedMode,
      `canvas=${empty.inCanvas}, editor mode=${empty.mode}`,
    );
    console.log(
      `      applied rule: ${expectedMode === 'fill' ? '.kw-editor-fill' : '.kw-editor-min'} .ProseMirror` +
        ` → computed height=${empty.computed?.height} min-height=${empty.computed?.minHeight}` +
        ` overflow-y=${empty.computed?.overflowY}`,
    );
    // The two rules are separate on purpose and must not be conflated:
    //   .kw-editor-fill (desktop Canvas): height min(58vh, 520px), floor 320px
    //   .kw-editor-min  (tablet/mobile/Flow): min-height 300px, no height
    check(
      `[${vp.name}] ${expectedMode} rule declares the height it should`,
      expectedMode === 'fill'
        ? empty.computed?.minHeight === '320px' && parseFloat(empty.computed?.height ?? '0') >= 320
        : empty.computed?.minHeight === '300px',
      expectedMode === 'fill'
        ? `min-height 320px floor, height ${empty.computed?.height}`
        : `min-height ${empty.computed?.minHeight}`,
    );
    check(
      `[${vp.name}] zero-note visit shows a usable editor`,
      empty.editorH >= 300 && empty.editable,
      `${empty.editorH}px, contenteditable=${empty.editable}`,
    );
    check(
      `[${vp.name}] zero-note visit opens a local draft`,
      empty.bodyText.includes('New draft (unsaved)'),
      empty.bodyText.includes('New draft (unsaved)') ? 'selector reads "New draft (unsaved)"' : 'no draft opened',
    );

    // ---- populated visit ----
    await openVisit(page, patient.id, fullVisit.id);
    const full = (await page.evaluate(MEASURE_JS)) as any;
    if (SHOTS) await page.screenshot({ path: join(OUT, `g0a-populated-${vp.name}.png`), fullPage: false });

    // Only meaningful if the populated record really rendered more sections
    // than the empty one — otherwise "unchanged height" proves nothing.
    check(
      `[${vp.name}] populated record renders more than the empty one`,
      full.lowerSections >= empty.lowerSections && full.bodyText.length > empty.bodyText.length,
      `${empty.lowerSections}→${full.lowerSections} cards, ${empty.bodyText.length}→${full.bodyText.length} chars`,
    );
    check(
      `[${vp.name}] editor height is population-independent`,
      Math.abs(full.editorH - empty.editorH) <= 2,
      `empty ${empty.editorH}px vs populated ${full.editorH}px`,
    );
    check(`[${vp.name}] no horizontal overflow`, !full.horizontalOverflow, `populated record`);
    check(
      `[${vp.name}] no nested scrollers beyond the page`,
      full.scrollers <= 1,
      `${full.scrollers} scrolling container(s)`,
    );

    // ---- signed and legacy states (viewport-independent, checked once) ----
    if (vp.name === '1920x1080') {
      await openVisit(page, patient.id, signedVisit.id);
      const signed = (await page.evaluate(MEASURE_JS)) as any;
      if (SHOTS) await page.screenshot({ path: join(OUT, 'g0a-signed-note.png') });
      check(
        '[signed] note is read-only and still legible',
        !signed.editable && signed.editorH >= 300 && signed.bodyText.includes('signed and cannot be edited'),
        `editable=${signed.editable}, ${signed.editorH}px`,
      );
      check(
        '[signed] no draft was auto-opened over an existing note',
        !signed.bodyText.includes('New draft (unsaved)'),
        signed.bodyText.includes('New draft (unsaved)') ? 'a draft was opened — wrong' : 'existing note selected',
      );

      if (legacy) {
        await openVisit(page, legacy.patient_id, legacy.visit_id);
        const leg = (await page.evaluate(MEASURE_JS)) as any;
        if (SHOTS) await page.screenshot({ path: join(OUT, 'g0a-legacy-note.png') });
        check(
          '[legacy] note is read-only and labelled',
          !leg.editable && leg.bodyText.includes('Legacy note'),
          `editable=${leg.editable}`,
        );
      } else {
        console.log('SKIP  [legacy] no legacy note exists in this tenant — nothing to check');
      }
    }

    await context.close();
  }

  await browser.close();

  // ---- no DB row was created just by opening the editor ----
  const noteRows = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${seed.tenant_id}, true)`;
    const r = await tx.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM clinical_notes WHERE visit_id = '${emptyVisit.id}'`,
    );
    return Number(r[0].n);
  });
  check(
    'opening the editor created NO clinical_notes row',
    noteRows === 0,
    `${noteRows} row(s) for the zero-note visit`,
  );
}

// Cleanup runs whatever happened, so a failed run leaves the dev database as
// clean as a passing one — the previous version accumulated a visit per run.
main()
  .then(async () => {
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
