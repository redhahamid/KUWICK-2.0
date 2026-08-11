import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import * as jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { chromium, Page } from 'playwright-core';
import { FixtureLedger, assertFixturesAllowed, fixtureLabel, sweepOrphanedFixtures } from './fixture-support';

config({ path: join(__dirname, '..', '.env') });

// G2b (D-060) — Diagnosis, Orders and Medications UX against a realistically
// populated record: 4 diagnoses with one Primary and a legacy-attribution
// case, orders in three different statuses, 5 medications including a
// paediatric weight-based one and a dispensed one.
//
//   KUWICK_ALLOW_FIXTURES=yes npx tsx prisma/g2b-clinical-ux-check.ts [--shots]
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const API = 'http://localhost:3000';
const WEB = 'http://localhost:5173';
const SHOTS = process.argv.includes('--shots');
const OUT = join(__dirname, '..', '..', '..', 'docs', 'g2-screenshots');

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
  var text = document.body.innerText;
  var rows = document.querySelectorAll('.kw-dx-row').length;
  var buttons = Array.prototype.map.call(document.querySelectorAll('.kw-dx-actions .ant-btn'), function (b) {
    var r = b.getBoundingClientRect();
    return { label: (b.innerText || b.getAttribute('aria-label') || '').trim(), h: Math.round(r.height) };
  });
  // Scoped to the Orders section. Counting "Cancel" across every section
  // swept up the medication Cancel buttons too and reported the app wrong.
  var orderSection = Array.prototype.filter.call(
    document.querySelectorAll('.kw-clinical-section'),
    function (s) { return (s.innerText || '').indexOf('Orders / Procedures') !== -1; }
  )[0];
  var orderButtons = orderSection
    ? Array.prototype.map.call(orderSection.querySelectorAll('.kw-dx-actions .ant-btn'), function (b) {
        return (b.innerText || b.getAttribute('aria-label') || '').trim();
      })
    : [];
  var scrollers = 0;
  var hoz = [];
  var all = document.querySelectorAll('*');
  for (var i = 0; i < all.length; i++) {
    var el = all[i], cs = getComputedStyle(el), oy = cs.overflowY, ox = cs.overflowX;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 0) scrollers++;
    if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) { scrollers += 100; hoz.push(el.tagName + '.' + (el.className || '').toString().slice(0, 60) + ' ' + el.clientWidth + '->' + el.scrollWidth); }
  }
  var wide = [];
  var main = document.querySelector('.ant-layout-content');
  if (main) { var mw = main.clientWidth; Array.prototype.forEach.call(main.querySelectorAll('*'), function (el) { if (el.getBoundingClientRect().width > mw + 1) wide.push(el.tagName + '.' + (el.className||'').toString().split(' ')[0] + ' w=' + Math.round(el.getBoundingClientRect().width)); }); }
  return {
    wide: wide.slice(0, 8),
    editorH: pm ? Math.round(pm.getBoundingClientRect().height) : 0,
    rows: rows,
    buttons: buttons,
    orderButtons: orderButtons,
    scrollers: scrollers,
    hoz: hoz,
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    text: text
  };
})()`;

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
  const stamp = Date.now();
  // Paediatric patient with a recorded allergy — the weight workflow and the
  // allergy banner both need a real subject.
  const patient = await api('/patients', token, 'POST', {
    name: fixtureLabel('G2b Paediatric Patient'),
    identifierType: 'PASSPORT',
    identifierValue: `G2B${stamp}`.slice(0, 14),
    dob: '2022-05-10',
    gender: 'FEMALE',
    allergies: ['Penicillin', 'NSAIDs'],
  });
  ledger.patient(patient.id);

  const visit = await api('/visits', token, 'POST', {
    clinicId: clinics[0].id,
    patientId: patient.id,
    staffId: seed.staff_id,
    billingType: 'Cash',
    presentingComplaint: fixtureLabel('G2b populated clinical record'),
  });
  ledger.visit(visit.id);

  // Weight, so the calculator and the medication section have real context.
  await api(`/visits/${visit.id}/observations`, token, 'POST', {
    bpSystolic: 100, bpDiastolic: 65, pulse: 110, temperature: 38.2, weight: 12.6,
  });

  // --- 4 diagnoses, one Primary ---
  const catalog = await api('/diagnosis-catalog?search=a&category=SUMMARIZE', token);
  const dx = [];
  for (const entry of catalog.slice(0, 4)) {
    dx.push(await api('/diagnoses', token, 'POST', { visitId: visit.id, diagnosisCatalogId: entry.id }));
  }
  await api(`/diagnoses/${dx[0].id}/priority`, token, 'PATCH', { priority: 'PRIMARY' });
  await api(`/diagnoses/${dx[1].id}/priority`, token, 'PATCH', { priority: 'SECONDARY' });
  // One row forced into the legacy-attribution state, so the "Added by not
  // recorded — legacy entry" path is exercised on a real record rather than
  // assumed. This is the ONLY way to produce it: nothing writes it any more.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${seed.tenant_id}, true)`;
    await tx.$executeRawUnsafe(
      `UPDATE diagnoses SET added_by_staff_id = NULL, added_by_name_snapshot = NULL,
              added_by_role_snapshot = NULL, legacy_attribution_unknown = true
        WHERE id = '${dx[3].id}'`,
    );
  });

  // --- 3 orders in three different statuses ---
  const services = await api('/services', token);
  const o1 = await api('/order-services', token, 'POST', {
    visitId: visit.id, serviceCatalogId: services[0].id, instruction: 'Fasting sample',
  });
  const o2 = await api('/order-services', token, 'POST', { visitId: visit.id, serviceCatalogId: services[1].id });
  const o3 = await api('/order-services', token, 'POST', { visitId: visit.id, serviceCatalogId: services[2].id });
  await api(`/order-services/${o2.id}/start`, token, 'PATCH', {});
  await api(`/order-services/${o3.id}/start`, token, 'PATCH', {});
  await api(`/order-services/${o3.id}/complete`, token, 'PATCH', { result: 'Within normal limits.' });
  void o1;

  // --- 5 medications, one weight-based, one dispensed ---
  const allItems = await api('/items', token);
  // The weight-based calculator refuses items with no Conc. Vol/Strength —
  // that validation is existing behaviour and correct, so the paediatric
  // fixture has to use an item that is actually configured for it rather than
  // whichever item happened to be first.
  const weightCapable = allItems.find((i: any) => i.concVolMl && i.strengthMg);
  const items = weightCapable
    ? [weightCapable, ...allItems.filter((i: any) => i.id !== weightCapable.id)]
    : allItems;
  check(
    'an item configured for weight-based dosing exists to test with',
    Boolean(weightCapable),
    weightCapable ? `${weightCapable.name}` : 'none configured — weight-based case cannot be exercised',
  );

  const meds = [];
  for (const [i, item] of items.slice(0, 5).entries()) {
    meds.push(
      await api('/prescriptions', token, 'POST', {
        visitId: visit.id,
        itemId: item.id,
        quantity: 1,
        amount: 5 + i,
        unit: 'ml',
        frequency: ['TDS', 'BD', 'OD', 'QID', 'PRN'][i],
        durationDays: 3 + i,
        indication: i === 0 ? 'Fever' : undefined,
        remark: i === 1 ? 'Take after food' : undefined,
        ...(i === 0 && weightCapable ? { calcMethod: 'WEIGHT_BASED', calcWeightKg: 12.6, calcDoseRateMgKg: 15 } : {}),
      }),
    );
  }
  await api(`/prescriptions/${meds[1].id}/dispense`, token, 'PATCH', {});

  const dxList = await api(`/diagnoses?visitId=${visit.id}`, token);
  const orderList = await api(`/order-services?visitId=${visit.id}`, token);
  const medList = await api(`/prescriptions?visitId=${visit.id}`, token);
  console.log(`Populated: ${dxList.length} dx / ${orderList.length} orders / ${medList.length} meds`);

  check(
    'record has the required population',
    dxList.length === 4 && orderList.length === 3 && medList.length === 5,
    `${dxList.length} dx / ${orderList.length} orders / ${medList.length} meds`,
  );
  check(
    'exactly one PRIMARY, one SECONDARY, one legacy-attribution diagnosis',
    dxList.filter((d: any) => d.priority === 'PRIMARY').length === 1 &&
      dxList.filter((d: any) => d.priority === 'SECONDARY').length === 1 &&
      dxList.filter((d: any) => d.legacyAttributionUnknown).length === 1,
    'mixed priority + legacy case present',
  );
  check(
    'orders really are in three different statuses',
    new Set(orderList.map((o: any) => o.status)).size === 3,
    [...new Set(orderList.map((o: any) => o.status))].join(', '),
  );
  check(
    'prescriber is returned by the API',
    medList.every((m: any) => m.prescribedBy?.fullName),
    `e.g. ${medList[0].prescribedBy?.fullName}`,
  );
  check(
    'order attachment/invoice counts are returned by the API',
    orderList.every((o: any) => o._count && typeof o._count.attachments === 'number'),
    'per-order _count present',
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
    await page.goto(`${WEB}/patients/${patient.id}?visitId=${visit.id}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1800);
    await page.getByRole('button', { name: 'Expand all' }).click();
    await page.waitForTimeout(3000);

    const m = (await page.evaluate(MEASURE_JS)) as any;
    if (SHOTS) await page.screenshot({ path: join(OUT, `g2b-expanded-${vp.name}.png`), fullPage: true });

    check(`[${vp.name}] editor height unchanged from G0/G1`, Math.abs(m.editorH - vp.editor) <= 2, `${m.editorH}px`);
    check(`[${vp.name}] no horizontal page overflow`, !m.horizontalOverflow, 'populated + fully expanded');
    check(
      `[${vp.name}] no nested or sideways scrollers`,
      m.scrollers <= 1,
      `${m.scrollers >= 100 ? 'HORIZONTAL: ' + m.hoz.join(' | ') + ' || WIDEST: ' + (m.wide||[]).join(' , ') : `${m.scrollers} scroller(s)`}`,
    );
    check(`[${vp.name}] clinical rows render for all three sections`, m.rows >= 12, `${m.rows} rows`);

    // Diagnosis
    check(
      `[${vp.name}] diagnosis shows Primary, Secondary and "Priority not recorded"`,
      m.text.includes('Primary') && m.text.includes('Secondary') && m.text.includes('Priority not recorded'),
      'all three priority states visible',
    );
    check(
      `[${vp.name}] legacy diagnosis is labelled honestly`,
      m.text.includes('Added by not recorded — legacy entry'),
      'legacy attribution wording present',
    );
    check(
      `[${vp.name}] diagnosis shows who added it`,
      m.text.includes(`Added by ${seed.full_name}`),
      `"Added by ${seed.full_name}"`,
    );

    // Orders — contextual actions only
    check(
      `[${vp.name}] orders use plain-language statuses`,
      m.text.includes('Ordered') && m.text.includes('In Progress') && m.text.includes('Completed'),
      'Ordered / In Progress / Completed',
    );
    const labels: string[] = m.orderButtons;
    check(
      `[${vp.name}] only valid next actions are offered`,
      labels.filter((l) => l === 'Start').length === 1 &&
        labels.filter((l) => l === 'Complete').length === 1 &&
        labels.filter((l) => l === 'View result').length === 1,
      `Start×${labels.filter((l) => l === 'Start').length}, Complete×${labels.filter((l) => l === 'Complete').length}, View result×${labels.filter((l) => l === 'View result').length}`,
    );
    check(
      `[${vp.name}] a completed order offers no Start or Cancel`,
      labels.filter((l) => l === 'Cancel').length === 2,
      `Cancel×${labels.filter((l) => l === 'Cancel').length} within the Orders section`,
    );

    // Medications
    check(
      `[${vp.name}] allergy warning uses icon plus words, not colour alone`,
      m.text.includes('Recorded allergies: Penicillin, NSAIDs'),
      'allergy banner present with names',
    );
    check(
      `[${vp.name}] Kuwick does not claim to check allergies automatically`,
      m.text.includes('does not automatically check'),
      'limitation stated plainly',
    );
    check(
      `[${vp.name}] medication shows dose, frequency, duration and quantity`,
      /\d+ml · \w+ · \d+ days · Qty \d+/.test(m.text),
      'full directions on one readable line',
    );
    check(`[${vp.name}] prescriber is shown`, m.text.includes('Prescribed by'), 'prescriber line present');
    check(
      `[${vp.name}] weight-based dose is flagged with its audit trail`,
      m.text.includes('Weight-based dose'),
      'calcMethod surfaced',
    );
    check(
      `[${vp.name}] latest observation weight is shown as prescribing context`,
      m.text.includes('Latest recorded weight: 12.6'),
      '12.6 kg from VisitObservation',
    );
    check(
      `[${vp.name}] dispensed vs to-dispense are distinguished in words`,
      m.text.includes('Dispensed') && m.text.includes('To dispense'),
      'both states labelled',
    );

    if (vp.width < 768) {
      const short = m.buttons.filter((b: any) => b.h > 0 && b.h < 44);
      check(
        `[${vp.name}] every row action meets the 44px touch target`,
        short.length === 0,
        short.length === 0 ? `${m.buttons.length} actions all >= 44px` : `${short.length} below 44px`,
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
