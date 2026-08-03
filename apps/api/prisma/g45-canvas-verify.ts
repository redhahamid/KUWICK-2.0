import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import * as jwt from 'jsonwebtoken';
import { chromium, Page } from 'playwright-core';

config({ path: join(__dirname, '..', '.env') });

// G4.5a–c (D-071) — verify the Canvas against a POPULATED visit.
//
// c2-canvas-measure.ts creates a thin visit and measures the editor. That is
// the wrong instrument here: the whole claim of G4.5 is that four populated
// panels are readable without a click, and an empty panel proves nothing.
// This script therefore takes an existing visit built by g45-canvas-populate.ts
// and measures what the doctor can actually see in the first screen.
//
//   npx tsx prisma/g45-canvas-verify.ts --patient=<id> --visit=<id> [--shots]
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const API = 'http://localhost:3000';
const WEB = 'http://localhost:5173';
const PASSWORD = process.env.C1_SHOT_PASSWORD;
const EMAIL = process.env.C1_SHOT_EMAIL ?? 'amira.rahman@smoke-test-clinic.test';
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const SHOTS = process.argv.includes('--shots');
const OUT = join(__dirname, '..', '..', '..', 'docs', 'g45-screenshots');

const VIEWPORTS = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: 'tablet-900', width: 900, height: 1000 },
  { name: 'mobile-375', width: 375, height: 812 },
];

// A source string, not a closure: tsx/esbuild rewrites nested arrows with a
// `__name` helper that does not exist in the page (same reason as C2).
const MEASURE_JS = `(() => {
  var vh = window.innerHeight;
  var vw = window.innerWidth;
  var rail = document.querySelector('.kw-canvas-rail') || document.querySelector('.kw-clinical-rail');
  var panelEls = rail ? rail.querySelectorAll('.kw-rail-panel') : [];
  var panels = [];
  for (var i = 0; i < panelEls.length; i++) {
    var p = panelEls[i];
    var rows = p.querySelectorAll('.kw-rail-row');
    var add = p.querySelector('.kw-rail-add');
    var last = rows.length ? rows[rows.length - 1] : null;
    panels.push({
      panel: p.getAttribute('data-panel'),
      rows: rows.length,
      lastRowInFold: last ? last.getBoundingClientRect().bottom <= vh : true,
      addInFold: add ? add.getBoundingClientRect().bottom <= vh : false,
      visible: p.getBoundingClientRect().height > 0,
      bottom: Math.round(p.getBoundingClientRect().bottom)
    });
  }

  var editor = document.querySelector('.ProseMirror');
  var editorRect = editor ? editor.getBoundingClientRect() : null;
  var editorFont = editor ? window.getComputedStyle(editor).fontSize : null;

  // Nothing may be collapsed behind a reveal click: count antd collapse
  // headers still present inside the canvas rail.
  var collapsedHeaders = rail ? rail.querySelectorAll('.ant-collapse-header').length : -1;

  var nav = document.querySelector('.kw-quick-nav');
  var navLinks = [];
  if (nav) {
    var links = nav.querySelectorAll('a,button');
    for (var j = 0; j < links.length; j++) {
      var lr = links[j].getBoundingClientRect();
      navLinks.push({ text: (links[j].textContent || '').trim(), h: Math.round(lr.height) });
    }
  }

  var small = 0;
  var controls = document.querySelectorAll('.kw-rail-row .ant-btn, .kw-rail-add .ant-btn, .kw-quick-nav a, .kw-quick-nav button');
  for (var k = 0; k < controls.length; k++) {
    if (controls[k].getBoundingClientRect().height < 44) small++;
  }

  var mainEl = document.querySelector('.kw-canvas-main');
  var railEl = document.querySelector('.kw-canvas-rail');
  return {
    viewport: { w: vw, h: vh },
    panels: panels,
    allFourInFold: panels.length === 4 && panels.every(function (p) { return p.addInFold && p.lastRowInFold; }),
    allPanelsVisible: panels.length === 4 && panels.every(function (p) { return p.visible; }),
    collapsedHeadersInRail: collapsedHeaders,
    editorHeight: editorRect ? Math.round(editorRect.height) : null,
    editorWidth: editorRect ? Math.round(editorRect.width) : null,
    editorFontSize: editorFont,
    mainWidth: mainEl ? Math.round(mainEl.getBoundingClientRect().width) : null,
    railWidth: railEl ? Math.round(railEl.getBoundingClientRect().width) : null,
    stackedOneColumn: mainEl && railEl
      ? Math.abs(mainEl.getBoundingClientRect().left - railEl.getBoundingClientRect().left) < 4
      : null,
    stackedWidthsMatch: mainEl && railEl
      ? Math.abs(mainEl.getBoundingClientRect().width - railEl.getBoundingClientRect().width) < 4
      : null,
    quickNav: navLinks,
    controlsUnder44px: small,
    horizontalOverflow: document.documentElement.scrollWidth > vw,
    bodyScrollWidth: document.documentElement.scrollWidth
  };
})()`;

/**
 * Two ways in, because the populated visit belongs to whichever tenant
 * g45-canvas-populate.ts found a full catalogue in — not necessarily the
 * account C1_SHOT_PASSWORD logs into.
 *
 *   --auth=<file>  the JSON g45-canvas-populate.ts printed. Its token is
 *                  re-signed with a fresh expiry rather than reused, so a
 *                  stale file cannot silently produce a logged-out screenshot.
 *   otherwise      the ordinary C1_SHOT_PASSWORD login.
 */
async function resolveAuth() {
  const authFile = arg('auth');
  if (authFile) {
    const saved = JSON.parse(readFileSync(authFile, 'utf8'));
    const state = saved.state ?? saved.auth ?? saved;
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) throw new Error('JWT_ACCESS_SECRET is not set.');
    const claims = jwt.decode(state.accessToken) as Record<string, unknown> | null;
    if (!claims?.sub) throw new Error('The saved token has no subject.');
    const token = jwt.sign(
      { sub: claims.sub, tenantId: claims.tenantId, staffId: claims.staffId, role: claims.role },
      secret,
      { expiresIn: '2h' },
    );
    return { accessToken: token, refreshToken: token, staff: state.staff, tenant: state.tenant };
  }

  if (!PASSWORD) throw new Error('Pass --auth=<file>, or set C1_SHOT_PASSWORD.');
  const loginRes = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!loginRes.ok) throw new Error(`login → ${loginRes.status} ${await loginRes.text()}`);
  return loginRes.json();
}

async function main() {
  const patientId = arg('patient');
  const visitId = arg('visit');
  if (!patientId || !visitId) throw new Error('Pass --patient=<id> --visit=<id> from g45-canvas-populate.ts.');
  if (SHOTS) mkdirSync(OUT, { recursive: true });

  const auth = await resolveAuth();

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  console.log('\nG4.5 CANVAS — POPULATED VISIT');
  console.log('='.repeat(78));

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    await context.addInitScript(
      (a) => {
        localStorage.setItem('kuwick-auth', JSON.stringify({ state: a, version: 0 }));
        localStorage.setItem('kuwick-record-view-layout', JSON.stringify({ state: { layout: 'canvas' }, version: 0 }));
      },
      { accessToken: auth.accessToken, refreshToken: auth.refreshToken, staff: auth.staff, tenant: auth.tenant },
    );
    const page: Page = await context.newPage();
    await page.goto(`${WEB}/patients/${patientId}?visitId=${visitId}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2200);

    const m = await page.evaluate(MEASURE_JS);
    console.log(`\n${vp.name}`);
    console.log(JSON.stringify(m, null, 2));

    // The quick-nav is only worth anything if it MOVES the viewport. Rendering
    // five buttons that do nothing would pass every measurement above.
    if (vp.width <= 375) {
      const jumps: Record<string, string> = {};
      for (const target of ['Diagnosis', 'Medications', 'Orders', 'Services', 'Note']) {
        await page.click(`.kw-quick-nav button:has-text("${target}")`);
        await page.waitForTimeout(900);
        const anchor = target === 'Note' ? 'kw-anchor-note' : `kw-anchor-${target.toLowerCase()}`;
        const seen = await page.evaluate((id) => {
          const el = document.getElementById(id);
          if (!el) return null;
          const top = Math.round(el.getBoundingClientRect().top);
          const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
          return { top, atEnd: Math.ceil(window.scrollY) >= maxScroll - 2, vh: window.innerHeight };
        }, anchor);
        if (!seen) {
          jumps[target] = 'ANCHOR MISSING';
          continue;
        }
        // Near the top, allowing for the sticky bar. The LAST section cannot
        // reach the top — the page runs out of scroll first — so landing in
        // view with the page at its scroll end is the correct outcome, not a
        // failure.
        const nearTop = seen.top >= -8 && seen.top <= 120;
        const inViewAtEnd = seen.atEnd && seen.top >= 0 && seen.top < seen.vh;
        jumps[target] = `${seen.top}px ${nearTop ? 'OK' : inViewAtEnd ? 'OK (page at scroll end)' : 'NOT SCROLLED'}`;
      }
      console.log('  quick-nav jumps:', JSON.stringify(jumps));
    }

    if (SHOTS) {
      // Deliberately NOT fullPage: the claim under review is what is in the
      // FIRST screen, and a full-page capture would hide exactly the failure
      // this is meant to catch.
      await page.screenshot({ path: join(OUT, `g45-${vp.name}.png`) });
      if (vp.width <= 375) {
        await page.screenshot({ path: join(OUT, `g45-${vp.name}-full.png`), fullPage: true });
      }
    }
    await context.close();
  }

  await browser.close();
  if (SHOTS) console.log(`\nscreenshots → ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
