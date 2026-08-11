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

  // D-072 — computed font sizes, read from the live page rather than from the
  // source. An inline fontSize can be overridden by a class, and what matters
  // clinically is what the doctor's screen actually renders.
  var px = function (el) {
    return el ? Math.round(parseFloat(window.getComputedStyle(el).fontSize)) : null;
  };
  var inPanel = function (name, sel) {
    var panel = document.querySelector('[data-panel="' + name + '"]');
    return panel ? px(panel.querySelector(sel)) : null;
  };
  var fonts = {
    panelHeading: inPanel('Diagnosis', '.kw-rail-head .ant-typography'),
    diagnosisName: inPanel('Diagnosis', '.kw-rail-row strong'),
    diagnosisIcd10: inPanel('Diagnosis', '.kw-rail-row .ant-tag'),
    diagnosisPriority: (function () {
      var panel = document.querySelector('[data-panel="Diagnosis"]');
      var tags = panel ? panel.querySelectorAll('.kw-rail-row .ant-tag') : [];
      return tags.length > 1 ? px(tags[1]) : null;
    })(),
    diagnosisSearchInput: inPanel('Diagnosis', '.kw-rail-add input'),
    diagnosisAddButton: inPanel('Diagnosis', '.kw-rail-add .ant-btn'),
    medicationName: inPanel('Medications', '.kw-rail-row strong'),
    medicationStrengthAndDose: (function () {
      var panel = document.querySelector('[data-panel="Medications"]');
      if (!panel) return null;
      var row = panel.querySelector('.kw-rail-row-main');
      if (!row) return null;
      var texts = row.querySelectorAll('.ant-typography');
      var sizes = [];
      for (var a = 0; a < texts.length; a++) sizes.push(px(texts[a]));
      return sizes;
    })(),
    medicationStatus: inPanel('Medications', '.kw-rail-row .ant-tag'),
    medicationAddButton: inPanel('Medications', '.kw-rail-add .ant-btn'),
    orderName: inPanel('Orders / Procedures', '.kw-rail-row strong'),
    orderStatus: inPanel('Orders / Procedures', '.kw-rail-row .ant-tag'),
    orderDetailLine: inPanel('Orders / Procedures', '.kw-rail-row-main > .ant-typography:not(strong)'),
    serviceName: inPanel('Direct Services', '.kw-rail-row strong'),
    serviceBillingTag: inPanel('Direct Services', '.kw-rail-row .ant-tag'),
    editor: px(editor)
  };

  // The attribution control must be a real focusable element with an
  // accessible name, not a tooltip hung on static text.
  var attr = document.querySelector('.kw-attribution-btn');
  var attribution = attr
    ? {
        tag: attr.tagName,
        focusable: attr.tabIndex >= 0 && !attr.disabled,
        ariaLabel: attr.getAttribute('aria-label'),
        width: Math.round(attr.getBoundingClientRect().width),
        height: Math.round(attr.getBoundingClientRect().height)
      }
    : null;

  // G4.5d (D-075) — the Visit Completion Bar. Everything below is measured
  // BEFORE any scrolling: the whole point is that a GP can issue an MC and
  // read the bill without hunting for them.
  var bar = document.querySelector('.kw-completion-bar');
  var barBtns = bar ? bar.querySelectorAll('.ant-btn') : [];
  var barLabels = [];
  var barSmall = 0;
  for (var m = 0; m < barBtns.length; m++) {
    var br = barBtns[m].getBoundingClientRect();
    barLabels.push({
      text: (barBtns[m].textContent || '').trim(),
      inFold: br.top >= 0 && br.bottom <= vh,
      h: Math.round(br.height)
    });
    if (br.height < 44) barSmall++;
  }
  var barText = bar ? (bar.textContent || '').replace(/\\s+/g, ' ').trim() : null;

  // No control on this bar may move money. Anything matching these words
  // would mean the billing surface leaked into the clinical band.
  var forbidden = [];
  for (var n = 0; n < barBtns.length; n++) {
    var label = (barBtns[n].textContent || '').trim().toLowerCase();
    if (/\\bpay\\b|\\bcancel\\b|quick add|add line|remove line|refund|void/.test(label)) {
      forbidden.push(label);
    }
  }

  // The completion bar must not overlap the sticky quick-nav on a phone.
  var navEl = document.querySelector('.kw-quick-nav');
  var overlapsQuickNav = false;
  if (bar && navEl && window.getComputedStyle(navEl).display !== 'none') {
    var b = bar.getBoundingClientRect();
    var nv = navEl.getBoundingClientRect();
    overlapsQuickNav = b.bottom > nv.top && b.top < nv.bottom;
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
    completionBar: {
      present: Boolean(bar),
      buttons: barLabels,
      allButtonsInFold: barLabels.length > 0 && barLabels.every(function (b) { return b.inFold; }),
      moneyMutatingControls: forbidden,
      buttonsUnder44px: barSmall,
      overlapsQuickNav: overlapsQuickNav,
      text: barText
    },
    fonts: fonts,
    attribution: attribution,
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
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      // A tap is not a click. The phone context must actually have touch, or
      // a hover-only affordance passes the very test meant to catch it.
      hasTouch: vp.width <= 375,
      isMobile: vp.width <= 375,
    });
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

    // D-072 — attribution must be reachable by KEYBOARD, not only by pointer.
    // Tab to it and confirm the popover opens from focus alone.
    if (vp.width >= 1366) {
      // Reached by TAB, not by a scripted .focus() — that proves it is in the
      // real tab order rather than merely focusable in principle.
      const tabbed = await page.evaluate(() => {
        const name = document.querySelector('[data-panel="Diagnosis"] .kw-rail-row strong') as HTMLElement | null;
        if (!name) return false;
        // Park focus just before the control and let the browser do the rest.
        const search = document.querySelector('[data-panel="Diagnosis"] .kw-rail-add input') as HTMLElement | null;
        search?.focus();
        return true;
      });
      let hops = 0;
      let onControl = false;
      while (tabbed && hops < 12 && !onControl) {
        await page.keyboard.press('Tab');
        hops += 1;
        onControl = await page.evaluate(() =>
          Boolean(document.activeElement?.classList?.contains('kw-attribution-btn')),
        );
      }
      // Focus ALONE must reveal it. Enter is not pressed: a keyboard user who
      // tabs to the control should not have to guess at an activation key.
      await page.waitForTimeout(600);
      const opened = await page.evaluate(() => {
        const pop = document.querySelector('.ant-popover:not(.ant-popover-hidden)');
        return pop ? (pop.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 140) : null;
      });
      const label = await page.evaluate(
        () => document.querySelector('.kw-attribution-btn')?.getAttribute('aria-label') ?? null,
      );
      console.log(`  attribution keyboard: reachedByTab=${onControl} (${hops} tabs) openedOnFocus=${JSON.stringify(opened)}`);
      console.log(`  attribution accessible name: ${JSON.stringify(label)}`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    // Touch: a tap must do what the mouse does. Emulated as a real tap, not a
    // click, because a hover-only affordance passes a click and fails a tap.
    if (vp.width <= 375) {
      const tapped = await page.evaluate(`(() => {
        var btn = document.querySelector('.kw-attribution-btn');
        if (!btn) return null;
        var r = btn.getBoundingClientRect();
        return { h: Math.round(r.height), w: Math.round(r.width) };
      })()`) as { h: number; w: number } | null;
      if (tapped) {
        // page.tap scrolls the element into view and dispatches a real touch
        // sequence, which is the thing a phone actually does.
        await page.tap('.kw-attribution-btn');
        await page.waitForTimeout(1200);
        const opened = (await page.evaluate(`(() => {
          var pops = document.querySelectorAll('.ant-popover');
          for (var i = 0; i < pops.length; i++) {
            if (pops[i].classList.contains('ant-popover-hidden')) continue;
            return (pops[i].textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120);
          }
          return pops.length > 0 ? 'HIDDEN (' + pops.length + ' in DOM)' : null;
        })()`)) as string | null;
        console.log(`  attribution touch: target=${tapped.w}x${tapped.h}px popoverText=${JSON.stringify(opened)}`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
    }

    // The quick-nav is only worth anything if it MOVES the viewport. Rendering
    // five buttons that do nothing would pass every measurement above.
    if (vp.width <= 375) {
      const jumps: Record<string, string> = {};
      const clearance: Record<string, unknown> = {};
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

        // D-072 — the sticky bar must not be covering what the jump was for.
        // Everything below is measured AGAINST the bar's own bottom edge, not
        // against the top of the viewport.
        // Source string, not a closure — the nested arrow gets rewritten with
        // a `__name` helper the page does not have (see MEASURE_JS above).
        const clear = await page.evaluate(`(() => {
          var nav = document.querySelector('.kw-quick-nav');
          var el = document.getElementById('${anchor}');
          if (!nav || !el) return null;
          var barBottom = nav.getBoundingClientRect().bottom;
          var vh = window.innerHeight;
          var probe = function (node) {
            if (!node) return 'absent';
            var r = node.getBoundingClientRect();
            if (r.top >= barBottom - 1 && r.top < vh) return 'clear';
            // Starting below the fold is not "covered" — it is simply further
            // down the page, which is what a long record looks like.
            if (r.top >= vh) return 'below fold';
            return r.bottom <= barBottom ? 'BEHIND STICKY BAR' : 'partially covered';
          };
          return {
            barBottom: Math.round(barBottom),
            heading: probe(el.querySelector('.kw-rail-head') || el.querySelector('.ant-card-head')),
            addControl: probe(el.querySelector('.kw-rail-add') || el.querySelector('.ant-card-head')),
            firstRow: probe(el.querySelector('.kw-rail-row') || el.querySelector('.ProseMirror'))
          };
        })()`);
        clearance[target] = clear;
        if (SHOTS) {
          // The evidence for "the sticky bar hides nothing" has to be lookable
          // at, not only assertable.
          await page.screenshot({ path: join(OUT, `g45-quicknav-${target.toLowerCase()}.png`) });
        }
      }
      console.log('  quick-nav jumps:', JSON.stringify(jumps));
      console.log('  sticky clearance:', JSON.stringify(clearance, null, 2));
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
