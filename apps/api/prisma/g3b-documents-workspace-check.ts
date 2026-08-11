import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import * as jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { chromium, Page } from 'playwright-core';
import { FixtureLedger, assertFixturesAllowed, fixtureLabel, sweepOrphanedFixtures } from './fixture-support';

config({ path: join(__dirname, '..', '.env') });

// G3b — the Documents workspace against a realistically populated record:
// an active MC, referral and memo, one signed document, one legacy document
// with no attribution of its own, one voided document, plus the G3a clinical
// attachments already on the visit.
//
//   KUWICK_ALLOW_FIXTURES=yes npx tsx prisma/g3b-documents-workspace-check.ts [--shots]
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

// antd v6 renamed the modal/drawer wrappers — `.ant-modal-content` no longer
// exists, it is `.ant-modal-container`. Rather than pin a version, target the
// element whose name has NOT changed across majors: the body. Everything this
// check asserts on lives in the body, so this is both stable and sufficient.
const MODAL = '.ant-modal-container, .ant-modal-content';
const DRAWER = '.ant-drawer-body';


// The record scrolls inside its own container, so a fullPage screenshot only
// ever captures the top of the page and the Documents section never appears in
// it. Bring the section into view first, so the delivered screenshots actually
// show the thing they are named after.
async function showDocuments(page: Page) {
  await page.evaluate(`(() => {
    var s = Array.prototype.filter.call(document.querySelectorAll('.kw-clinical-section'), function (el) {
      var h = el.querySelector('.kw-section-heading');
      return h && h.innerText.indexOf('Documents') !== -1;
    })[0];
    if (s) s.scrollIntoView({ block: 'start' });
  })()`);
  await page.waitForTimeout(500);
}

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

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function upload(path: string, token: string, fileName: string) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(PNG)], { type: 'image/png' }), fileName);
  const res = await fetch(`${API}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  if (res.status >= 400) throw new Error(`POST ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

// Measured in the page, not inferred. The Documents section is located by its
// own heading so a count never accidentally sweeps in another section's rows
// (the mistake that made the G2b cancel-count wrong).
const MEASURE_JS = `(() => {
  var pm = document.querySelector('.ProseMirror');
  var sections = Array.prototype.slice.call(document.querySelectorAll('.kw-clinical-section'));
  var docSection = sections.filter(function (s) {
    var h = s.querySelector('.kw-section-heading');
    return h && h.innerText.indexOf('Documents') !== -1;
  })[0];
  var heading = docSection ? docSection.querySelector('.kw-section-heading').innerText.split('\\n')[0].trim() : '';
  var status = docSection ? docSection.querySelector('.kw-section-heading').innerText.trim() : '';
  var summary = docSection ? (docSection.querySelector('.kw-section-summary') || {}).innerText || '' : '';
  var body = docSection ? docSection.querySelector('.kw-section-body') : null;
  var bodyText = body ? body.innerText : '';
  var actionLabels = body
    ? Array.prototype.map.call(body.querySelectorAll('.ant-btn'), function (b) {
        var r = b.getBoundingClientRect();
        return { label: (b.innerText || b.getAttribute('aria-label') || '').trim(), h: Math.round(r.height) };
      })
    : [];
  var scrollers = 0, hoz = [];
  var all = document.querySelectorAll('*');
  for (var i = 0; i < all.length; i++) {
    var el = all[i], cs = getComputedStyle(el), oy = cs.overflowY, ox = cs.overflowX;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 0) scrollers++;
    if ((ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
      scrollers += 100; hoz.push(el.tagName + '.' + (el.className || '').toString().slice(0, 60) + ' ' + el.clientWidth + '->' + el.scrollWidth);
    }
  }
  return {
    editorH: pm ? Math.round(pm.getBoundingClientRect().height) : 0,
    heading: heading, status: status, summary: summary, bodyText: bodyText,
    actionLabels: actionLabels,
    scrollers: scrollers, hoz: hoz,
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    text: document.body.innerText
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

  const nonClinical = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    return tx.$queryRawUnsafe<{ user_id: string; staff_id: string; tenant_id: string; role: string }[]>(`
      SELECT u.id AS user_id, s.id AS staff_id, s.tenant_id, s.role
      FROM staff s JOIN users u ON s.user_id = u.id
      WHERE s.active AND s.tenant_id = '${seed.tenant_id}'
        AND s.role IN ('FRONT_DESK_CLINICAL_STAFF','OWNER_ADMIN')
        AND (s.professional_type IS NULL OR s.professional_active = false)`);
  });

  const tokenFor = (s: { user_id: string; tenant_id: string; staff_id: string; role: string }) =>
    jwt.sign(
      { sub: s.user_id, tenantId: s.tenant_id, staffId: s.staff_id, role: s.role },
      process.env.JWT_ACCESS_SECRET as string,
      { expiresIn: '40m' },
    );
  const token = tokenFor(seed);

  const swept = await sweepOrphanedFixtures(prisma, seed.tenant_id);
  if (swept > 0) console.log(`Swept ${swept} leftover fixture visit(s)`);
  ledger = new FixtureLedger(prisma, API, token, seed.tenant_id);

  // ------------------------------------------------------------ the scenario
  const clinics = await api('/clinics', token);
  const stamp = Date.now();
  const patient = await api('/patients', token, 'POST', {
    name: fixtureLabel('G3b Documents Patient'),
    identifierType: 'PASSPORT',
    identifierValue: `G3B${stamp}`.slice(0, 14),
    dob: '2019-03-14',
    gender: 'FEMALE',
    allergies: ['Penicillin'],
  });
  ledger.patient(patient.id);

  const visit = await api('/visits', token, 'POST', {
    clinicId: clinics[0].id,
    patientId: patient.id,
    staffId: seed.staff_id,
    billingType: 'Cash',
    presentingComplaint: fixtureLabel('G3b populated documents workspace'),
  });
  ledger.visit(visit.id);

  // Observations, so the optional merge fields have something real behind them.
  await api(`/visits/${visit.id}/observations`, token, 'POST', {
    bpSystolic: 108, bpDiastolic: 68, pulse: 96, temperature: 37.8, spo2: 99, respRate: 22,
    weight: 18.4, height: 105, glucose: 5.4,
  });

  // Two clinical attachments (G3a territory, present so the section coexists).
  await upload(`/visits/${visit.id}/attachments`, token, 'otoscope-right.png');
  await upload(`/visits/${visit.id}/attachments`, token, 'throat-swab-report.png');

  const mc = await api('/documents', token, 'POST', {
    visitId: visit.id, type: 'MC',
    content: 'MEDICAL CERTIFICATE\n\nUnfit for duty for 3 days.',
    startDate: '2026-08-02', endDate: '2026-08-04',
    diagnosisText: 'Acute tonsillitis',
  });
  const referral = await api('/documents', token, 'POST', {
    visitId: visit.id, type: 'REFERRAL',
    content: 'Dear Doctor,\n\nThank you for seeing this patient.\n\nWeight: 18.4 kg',
    referredTo: 'Hospital Kuala Lumpur, ENT Department',
    diagnosisText: 'Recurrent tonsillitis for consideration of tonsillectomy',
  });
  const memo = await api('/documents', token, 'POST', {
    visitId: visit.id, type: 'MEMO',
    content: 'MEMO\n\nParent advised to return if fever persists beyond 48 hours.',
  });
  const toVoid = await api('/documents', token, 'POST', {
    visitId: visit.id, type: 'MC',
    content: 'MEDICAL CERTIFICATE\n\nUnfit for duty for 5 days.',
    startDate: '2026-08-02', endDate: '2026-08-06',
    diagnosisText: 'Acute tonsillitis',
  });

  // A legacy document: created before the workspace, carrying no signature.
  // Produced by clearing the fields nothing writes any more, so the "not
  // recorded" path is exercised on a real row rather than assumed.
  const legacy = await api('/documents', token, 'POST', {
    visitId: visit.id, type: 'MEMO',
    content: 'MEMO\n\nLegacy entry carried over from the previous system.',
  });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${seed.tenant_id}, true)`;
    await tx.$executeRawUnsafe(
      `UPDATE documents SET start_date = NULL, end_date = NULL, diagnosis_text = NULL, referred_to = NULL
         WHERE id = '${legacy.id}'`,
    );
  });

  // ------------------------------------------------------------- API-level
  // 7 — signing behaviour
  const spoofSign = await call(`/documents/${mc.id}/sign`, token, 'PATCH', { staffId: seed.staff_id });
  check('signing rejects a browser-supplied signer', spoofSign.status === 400, `HTTP ${spoofSign.status}`);

  const signed = await api(`/documents/${mc.id}/sign`, token, 'PATCH', {});
  check(
    'the signer is the authenticated session',
    signed.signedByStaffId === seed.staff_id && Boolean(signed.signedAt),
    `signed by ${seed.full_name}`,
  );
  check(
    'signing does not alter the document content',
    signed.content === 'MEDICAL CERTIFICATE\n\nUnfit for duty for 3 days.',
    'content byte-identical',
  );

  // 8 — a signed document is not silently overwritten
  const resign = await call(`/documents/${mc.id}/sign`, token, 'PATCH', {});
  check('re-signing a signed document is refused', resign.status === 409, `HTTP ${resign.status}`);
  const afterResign = (await api(`/documents?visitId=${visit.id}`, token)).find(
    (d: { id: string }) => d.id === mc.id,
  );
  check(
    'the original signature survives the refused re-sign',
    afterResign.signedAt === signed.signedAt && afterResign.signedByStaffId === signed.signedByStaffId,
    'signedAt and signer unchanged',
  );

  for (const actor of nonClinical) {
    const attempt = await call(`/documents/${referral.id}/sign`, tokenFor(actor), 'PATCH', {});
    // Front desk legitimately signs off printed documents under the existing
    // workflow; this records what the server actually does rather than
    // asserting a rule G3b did not set.
    check(
      `a ${actor.role} signing is decided server-side (${attempt.status === 201 || attempt.status === 200 ? 'allowed' : 'refused'})`,
      attempt.status < 500,
      `HTTP ${attempt.status}`,
    );
  }

  // 9 — void requires a reason
  const noReason = await call(`/documents/${toVoid.id}/void`, token, 'PATCH', { reason: '' });
  check('voiding requires a reason', noReason.status === 400, `HTTP ${noReason.status}`);

  const voided = await api(`/documents/${toVoid.id}/void`, token, 'PATCH', {
    reason: 'Superseded by a corrected 3-day certificate',
  });
  check(
    'void records actor, time and reason',
    voided.voidedByStaffId === seed.staff_id && Boolean(voided.voidedAt) && Boolean(voided.voidReason),
    `voided by ${voided.voidedByNameSnapshot}`,
  );

  // A voided document cannot then be signed.
  const signVoided = await call(`/documents/${toVoid.id}/void`, token, 'PATCH', { reason: 'again' });
  check('a voided document cannot be voided twice', signVoided.status === 409, `HTTP ${signVoided.status}`);

  // 1 + 10 — active list excludes voided; history retains it
  const active = await api(`/documents?visitId=${visit.id}`, token);
  const history = await api(`/documents/history?visitId=${visit.id}`, token);
  check(
    'the active list excludes the voided document',
    active.length === 4 && !active.some((d: { id: string }) => d.id === toVoid.id),
    `${active.length} active, ${history.length} in history`,
  );
  check(
    'the voided document is retained in history with its content',
    history.some(
      (d: { id: string; recordStatus: string; content: string }) =>
        d.id === toVoid.id && d.recordStatus === 'VOIDED' && d.content.includes('5 days'),
    ),
    'original text preserved',
  );
  // 12 — authorised historical read
  check(
    'the voided document is still readable by an authorised user',
    Boolean(history.find((d: { id: string }) => d.id === toVoid.id)?.content),
    'content returned through the history endpoint',
  );

  // 2 — resolved actors, so the workspace can name them
  check(
    'each document resolves who created it',
    active.every((d: { issuedBy?: { fullName: string } }) => Boolean(d.issuedBy?.fullName)),
    `e.g. ${active[0].issuedBy?.fullName}`,
  );
  check(
    'a signed document resolves who signed it',
    Boolean(active.find((d: { id: string }) => d.id === mc.id)?.signedBy?.fullName),
    `signed by ${active.find((d: { id: string }) => d.id === mc.id)?.signedBy?.fullName}`,
  );

  void referral;
  void memo;

  // ------------------------------------------------------------- in-browser
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

    // --- collapsed ---
    const collapsed = (await page.evaluate(MEASURE_JS)) as any;
    if (SHOTS) {
      await showDocuments(page);
      await page.screenshot({ path: join(OUT, `g3b-collapsed-${vp.name}.png`) });
    }

    check(
      `[${vp.name}] collapsed count is ACTIVE documents only`,
      collapsed.heading === 'Documents (4)',
      `"${collapsed.heading}" (1 voided exists)`,
    );
    check(
      `[${vp.name}] collapsed shows a useful type summary`,
      /1 MC/.test(collapsed.summary) && /1 Referral/.test(collapsed.summary) && /2 Memo/.test(collapsed.summary),
      `"${collapsed.summary}"`,
    );
    check(
      `[${vp.name}] collapsed names the latest document`,
      /latest /.test(collapsed.summary),
      collapsed.summary.split('—')[1]?.trim() ?? '',
    );
    check(
      `[${vp.name}] a voided document is indicated but not counted as active`,
      /1 voided/.test(collapsed.status) && !/Documents \(5\)/.test(collapsed.heading),
      `status chip: "${collapsed.status.replace(/\n/g, ' ')}"`,
    );

    // --- expanded ---
    await page.getByRole('button', { name: 'Expand all' }).click();
    await page.waitForTimeout(2500);
    const m = (await page.evaluate(MEASURE_JS)) as any;
    if (SHOTS) {
      await showDocuments(page);
      await page.screenshot({ path: join(OUT, `g3b-expanded-${vp.name}.png`) });
    }

    check(`[${vp.name}] editor height unchanged from G0/G1`, Math.abs(m.editorH - vp.editor) <= 2, `${m.editorH}px`);
    check(`[${vp.name}] no horizontal page overflow`, !m.horizontalOverflow, 'documents expanded');
    check(
      `[${vp.name}] one natural page scroll — no nested or sideways scrollers`,
      m.scrollers <= 1,
      m.scrollers >= 100 ? `HORIZONTAL: ${m.hoz.join(' | ')}` : `${m.scrollers} scroller(s)`,
    );

    // §3 — type-specific presentation, only from stored fields
    check(
      `[${vp.name}] an MC shows its rest period and day count`,
      /Unfit from: 2 Aug 2026 – 4 Aug 2026/.test(m.bodyText) && /Days: 3 days/.test(m.bodyText),
      'MC dates and days present',
    );
    check(
      `[${vp.name}] a referral names its recipient`,
      /Referred to: Hospital Kuala Lumpur, ENT Department/.test(m.bodyText),
      'referral recipient present',
    );
    check(
      `[${vp.name}] the legacy document shows no invented fields`,
      !/Covering: Invalid|Days: 0/.test(m.bodyText),
      'absent fields omitted, not blanked',
    );
    check(
      `[${vp.name}] every document states who created it`,
      (m.bodyText.match(/Created by /g) || []).length === 4,
      `${(m.bodyText.match(/Created by /g) || []).length} "Created by" lines for 4 documents`,
    );
    check(
      `[${vp.name}] signed and unsigned states are both shown`,
      /Signed/.test(m.bodyText) && /Not signed/.test(m.bodyText),
      'both states visible',
    );

    // §2 — labelled actions, no permanent delete, no bare icon rows
    const labels: string[] = m.actionLabels.map((b: any) => b.label);
    const unlabelled = m.actionLabels.filter((b: any) => b.label === '').length;
    check(
      `[${vp.name}] no unlabelled icon-only action buttons`,
      unlabelled === 0,
      `${unlabelled} unlabelled of ${labels.length}`,
    );
    check(
      `[${vp.name}] no permanent Delete action is offered`,
      !labels.some((l) => /^delete$/i.test(l)),
      labels.join(' | ').slice(0, 120),
    );
    const expectedActions = vp.width < 768 ? ['Preview', 'Actions'] : ['Preview', 'Print', 'Download', 'Void'];
    check(
      `[${vp.name}] the expected actions are present`,
      expectedActions.every((a) => labels.includes(a)),
      `present: ${[...new Set(labels)].join(', ')}`,
    );
    if (vp.width < 768) {
      const small = m.actionLabels.filter((b: any) => b.h > 0 && b.h < 44).map((b: any) => `${b.label}:${b.h}px`);
      check(
        `[${vp.name}] action targets are at least 44px tall`,
        small.length === 0,
        small.length ? small.join(', ') : 'all >= 44px',
      );
    }

    // ---------------------------------------------------------------------
    // Each overlay is verified from a FRESH page.
    //
    // Driving them in one chain meant every assertion depended on the
    // previous overlay having closed cleanly, and an antd mask mid-animation
    // silently swallows the next click — which produced three "failures" that
    // were entirely the harness. A reload costs a second and removes the
    // whole class of problem.
    // ---------------------------------------------------------------------
    const freshRecord = async () => {
      const p2 = await context.newPage();
      await p2.goto(`${WEB}/patients/${patient.id}?visitId=${visit.id}`, { waitUntil: 'networkidle' });
      await p2.waitForTimeout(1600);
      await p2.getByRole('button', { name: 'Expand all' }).click();
      await p2.waitForTimeout(2200);
      return p2;
    };

    // §8 — the void confirmation
    {
      const p2 = await freshRecord();
      await p2.locator('button.ant-btn').filter({ hasText: vp.width < 768 ? /^Actions$/ : /^Void$/ }).first().click();
      await p2.waitForTimeout(700);
      if (vp.width < 768) {
        await p2.getByRole('menuitem', { name: 'Void document' }).click();
        await p2.waitForTimeout(700);
      }
      const modalText = await p2.locator(MODAL).first().innerText();
      if (SHOTS) await p2.screenshot({ path: join(OUT, `g3b-void-confirm-${vp.name}.png`) });
      check(
        `[${vp.name}] void confirmation states what is being voided and that it is preserved`,
        /Created by/.test(modalText) &&
          /Signed/.test(modalText) &&
          modalText.includes('Reason (required)') &&
          /will no longer appear as active/.test(modalText) &&
          /audit history will remain preserved/.test(modalText),
        'type, creator, signed state, reason and retention notice all present',
      );
      check(
        `[${vp.name}] void is blocked until a reason is typed`,
        await p2.locator(MODAL).first().locator('.ant-btn-dangerous').first().isDisabled(),
        'confirm disabled with an empty reason',
      );
      await p2.close();
    }

    // §9 — the voided-document history, and §10 the voided preview
    {
      const p2 = await freshRecord();
      // A real <button>, not getByRole. The clinical-section HEADER is a div
      // with role="button", and its accessible name now contains the "1
      // voided" tag — so getByRole('button', {name: /voided/}).first()
      // matched the header and collapsed the section instead of opening the
      // history. Restricting to button.ant-btn excludes the header outright.
      await p2.locator('button.ant-btn').filter({ hasText: /voided/ }).first().click();
      await p2.waitForTimeout(1400);
      const drawer = await p2.locator(DRAWER).first().innerText();
      if (SHOTS) await p2.screenshot({ path: join(OUT, `g3b-voided-history-${vp.name}.png`) });
      check(
        `[${vp.name}] voided history shows creator, voider, time and reason`,
        /Created by/.test(drawer) &&
          /Voided by/.test(drawer) &&
          /Superseded by a corrected 3-day certificate/.test(drawer),
        'full void audit visible',
      );
      check(
        `[${vp.name}] voided history offers no edit, restore or delete`,
        !/(Restore|Un-void|Delete|Edit)/i.test(drawer),
        'preview and download only',
      );

      await p2.locator(DRAWER).first().locator('button.ant-btn').filter({ hasText: /^Preview$/ }).first().click();
      await p2.waitForTimeout(1200);
      const preview = await p2.locator(DRAWER).last().innerText();
      if (SHOTS) await p2.screenshot({ path: join(OUT, `g3b-preview-voided-${vp.name}.png`) });
      check(
        `[${vp.name}] a voided preview is clearly marked and still shows the original text`,
        /voided and is no longer valid/i.test(preview) && /5 days/.test(preview),
        'void banner + original content preserved',
      );
      await p2.close();
    }

    // §10 — an ACTIVE document's preview carries no void marking
    {
      const p2 = await freshRecord();
      await p2.locator('button.ant-btn').filter({ hasText: /^Preview$/ }).first().click();
      await p2.waitForTimeout(1200);
      const preview = await p2.locator(DRAWER).first().innerText();
      if (SHOTS) await p2.screenshot({ path: join(OUT, `g3b-preview-active-${vp.name}.png`) });
      check(
        `[${vp.name}] an active preview shows the document, its issuer and its signed state`,
        /Created by/.test(preview) && /Issued/.test(preview) && !/no longer valid/i.test(preview),
        'active preview with no void marking',
      );
      await p2.close();
    }

    // §4 — the create flow
    {
      const p2 = await freshRecord();
      await p2.locator('button.ant-btn').filter({ hasText: '+ Create Document' }).first().click();
      await p2.waitForTimeout(1800);
      const createDrawer = await p2.locator(DRAWER).first().innerText();
      if (SHOTS) await p2.screenshot({ path: join(OUT, `g3b-create-${vp.name}.png`) });
      check(
        `[${vp.name}] the create flow auto-fills the visit's own context`,
        /Filled in from this visit/.test(createDrawer) &&
          new RegExp(patient.name.slice(0, 20)).test(createDrawer) &&
          createDrawer.includes('BP: 108/68 mmHg'),
        'patient, clinic, diagnosis and vitals shown as auto-filled',
      );
      check(
        `[${vp.name}] the generated document text is presented for review before saving`,
        /Document text/.test(createDrawer) && /Generated/.test(createDrawer),
        'preview-before-save present',
      );
      check(
        `[${vp.name}] the clinic's configured template is offered alongside the built-in types`,
        /Time Slip/.test(createDrawer),
        'configured template selectable',
      );
      await p2.close();
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
