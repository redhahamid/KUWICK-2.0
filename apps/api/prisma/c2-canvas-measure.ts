import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import { chromium, Page } from 'playwright-core';

config({ path: join(__dirname, '..', '.env') });

// C2 — measure the Canvas workspace so "the editor is too small" is a number,
// not an impression. Run before and after the layout change.
//
//   npx tsx prisma/c2-canvas-measure.ts [--label before|after] [--shots]
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const API = 'http://localhost:3000';
const WEB = 'http://localhost:5173';
const PASSWORD = process.env.C1_SHOT_PASSWORD;
const EMAIL = process.env.C1_SHOT_EMAIL ?? 'amira.rahman@smoke-test-clinic.test';
const LABEL = (process.argv.find((a) => a.startsWith('--label='))?.split('=')[1] ?? 'measure') as string;
const SHOTS = process.argv.includes('--shots');
const OUT = join(__dirname, '..', '..', '..', 'docs', 'c2-screenshots');

const VIEWPORTS = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: 'tablet-900', width: 900, height: 1000 },
  { name: 'mobile-375', width: 375, height: 812 },
];

async function api(path: string, token: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

interface Measurement {
  editor: { w: number; h: number } | null;
  sidebar: { w: number; h: number } | null;
  viewport: { w: number; h: number };
  horizontalOverflow: boolean;
  bodyScrollWidth: number;
  independentScrollers: number;
  scrollerDetail: { tag: string; cls: string; h: number }[];
}

// Written as a source string on purpose: tsx/esbuild rewrites nested arrow
// functions with a `__name` helper that does not exist in the page, so a
// normal closure passed to page.evaluate throws ReferenceError.
const MEASURE_JS = `(() => {
  var rect = function (sel) {
    var el = document.querySelector(sel);
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  };
  var scrollers = [];
  var all = document.querySelectorAll('*');
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var oy = getComputedStyle(el).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 2) {
      scrollers.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().slice(0, 55),
        h: Math.round(el.getBoundingClientRect().height)
      });
    }
  }
  return {
    editor: rect('.ProseMirror'),
    sidebar: rect('.kw-canvas-sidebar'),
    viewport: { w: window.innerWidth, h: window.innerHeight },
    horizontalOverflow: document.body.scrollWidth > window.innerWidth + 1,
    bodyScrollWidth: document.body.scrollWidth,
    independentScrollers: scrollers.length,
    scrollerDetail: scrollers.slice(0, 10)
  };
})()`;

async function measure(page: Page): Promise<Measurement> {
  return page.evaluate(MEASURE_JS) as Promise<Measurement>;
}

async function main() {
  if (!PASSWORD) throw new Error('Set C1_SHOT_PASSWORD before running.');
  if (SHOTS) mkdirSync(OUT, { recursive: true });

  const loginRes = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const auth = await loginRes.json();
  const token: string = auth.accessToken;
  const clinics = await api('/clinics', token);
  const stamp = Date.now();

  const patient = await api('/patients', token, 'POST', {
    name: `ZZ C2 Layout Patient ${stamp}`,
    identifierType: 'NRIC',
    identifierValue: `L${stamp}`.slice(0, 14),
  });
  const visit = await api('/visits', token, 'POST', {
    patientId: patient.id,
    clinicId: clinics[0].id,
    staffId: auth.staff.id,
    billingType: 'Self-pay',
    presentingComplaint: 'Fever and cough',
  });
  await api(`/visits/${visit.id}/observations`, token, 'POST', {
    bpSystolic: 122, bpDiastolic: 78, pulse: 84, temperature: 37.8, spo2: 98, weight: 62.5, height: 168,
  });
  await api(`/visits/${visit.id}/clinical-notes`, token, 'POST', {
    notes: '<p>Patient reports fever for three days with a productive cough.</p>',
  });

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  console.log(`\nCANVAS MEASUREMENTS (${LABEL})`);
  console.log('='.repeat(78));

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    await context.addInitScript(
      (a) => {
        localStorage.setItem('kuwick-auth', JSON.stringify({ state: a, version: 0 }));
        localStorage.setItem('kuwick-record-view-layout', JSON.stringify({ state: { layout: 'canvas' }, version: 0 }));
      },
      { accessToken: token, refreshToken: auth.refreshToken, staff: auth.staff, tenant: auth.tenant },
    );
    const page = await context.newPage();
    await page.goto(`${WEB}/patients/${patient.id}?visitId=${visit.id}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1600);

    const m = await measure(page);
    console.log(`\n${vp.name}  (viewport ${m.viewport.w}x${m.viewport.h})`);
    console.log(`  editor typing area : ${m.editor ? `${m.editor.w} x ${m.editor.h}px` : 'NOT FOUND'}`);
    console.log(`  sidebar width      : ${m.sidebar ? `${m.sidebar.w}px` : 'n/a'}`);
    console.log(`  horizontal overflow: ${m.horizontalOverflow ? `YES (${m.bodyScrollWidth}px)` : 'no'}`);
    console.log(`  nested scrollers   : ${m.independentScrollers}`);
    for (const s of m.scrollerDetail) {
      console.log(`      - ${s.tag}.${s.cls} (${s.h}px)`);
    }

    if (SHOTS) {
      await page.screenshot({ path: join(OUT, `${LABEL}-${vp.name}.png`) });
    }
    await context.close();
  }

  await browser.close();
  console.log(`\npatient=${patient.id} visit=${visit.id}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
