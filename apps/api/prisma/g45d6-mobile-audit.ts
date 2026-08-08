import { join } from 'node:path';
import { config } from 'dotenv';
import { chromium, Page } from 'playwright-core';

config({ path: join(__dirname, '..', '.env') });

/**
 * G4.5d6 — MEASURE the mobile damage before changing a line of CSS.
 *
 * UAT reported two symptoms on an iPhone: page titles wrapping vertically
 * (one word per line) and desktop tables running off the side of the screen.
 * Both are the same underlying fault — something in the row refuses to
 * shrink, so the page grows wider than the viewport — but "something"
 * is not a thing you can fix. This walks every route at 390x844 and 375x812
 * and reports, per page, exactly which elements are wider than the screen.
 *
 *   npx tsx prisma/g45d6-mobile-audit.ts
 */
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium';
const API = 'http://localhost:3000';
const WEB = 'http://localhost:5173';

const VIEWPORTS = [
  { name: 'iPhone 14 (390x844)', width: 390, height: 844 },
  { name: 'iPhone SE (375x812)', width: 375, height: 812 },
];

const ROUTES = [
  '/appointments',
  '/patients',
  '/queue',
  '/dispensary',
  '/procedure-queue',
  '/management/reports',
  '/management/reports/day-end',
  '/management/reports/sales',
  '/management/reports/patients',
  '/management/reports/invoices',
  '/management/reports/drug-movement',
  '/management/reports/wait-times',
  '/management/operation/doctor-schedules',
  '/management/hr/staff',
  '/management/hr/attendance',
  '/management/hr/leave-requests',
  '/management/stock/health',
  '/management/stock/items',
  '/management/stock/suppliers',
  '/management/stock/purchase-orders',
  '/management/panel/clinics',
  '/management/panel/claims',
  '/settings/organisation/branches',
  '/settings/queue/rooms',
  '/settings/queue/display',
  '/settings/clinical/services',
  '/settings/clinical/consultation-tariffs',
  '/settings/clinical/diagnoses',
  '/settings/documents/templates',
  '/settings/hr/public-holidays',
];

interface Offender {
  selector: string;
  width: number;
  text: string;
}

async function login(email: string) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'DevLocal!2026' }),
  });
  const body = (await res.json()) as Record<string, unknown>;
  if (!body.accessToken) throw new Error(`Login failed for ${email}: ${JSON.stringify(body)}`);
  return body;
}

/**
 * Every element whose box extends past the viewport.
 *
 * Written without inner function declarations on purpose: the TypeScript
 * runner rewrites those with a `__name` helper that does not exist inside the
 * browser, and the whole audit dies on the first page.
 */
async function overflowing(page: Page, viewportWidth: number): Promise<{ escaping: Offender[]; contained: Offender[] }> {
  return page.evaluate((vw) => {
    const out: { selector: string; width: number; text: string }[] = [];
    const contained_out: { selector: string; width: number; text: string }[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right <= vw + 1 && r.left >= -1) continue;

      // A wide element INSIDE something that scrolls sideways on purpose (an
      // antd Table body, a Tabs nav strip) is not a page-level fault — the
      // user can reach it and the page itself does not move. Only report an
      // element that escapes every scroller between it and the page.
      let contained = false;
      let node: Element | null = el;
      while (node && node !== document.body) {
        const st = getComputedStyle(node);
        if (st.overflowX === 'auto' || st.overflowX === 'scroll' || st.overflowX === 'hidden') {
          const box = node.getBoundingClientRect();
          if (box.right <= vw + 1) {
            contained = true;
            break;
          }
        }
        node = node.parentElement;
      }
      if (contained) {
        // Reachable by scrolling its own box — not a page-level fault, but
        // still a desktop layout on a phone. Reported separately so neither
        // class can hide behind the other.
        contained_out.push({
          selector: el.tagName.toLowerCase(),
          width: Math.round(r.width),
          text: (el.textContent ?? '').trim().slice(0, 40),
        });
        continue;
      }

      const raw = el.className && typeof el.className === 'string' ? el.className : '';
      const cls = raw.split(/\s+/).filter(Boolean).filter((c) => !c.startsWith('css-')).slice(0, 3).join('.');
      out.push({
        selector: el.tagName.toLowerCase() + (cls ? '.' + cls : ''),
        width: Math.round(r.width),
        text: (el.textContent ?? '').trim().slice(0, 60),
      });
    }
    // Deepest-last: the outermost offender is the one worth fixing.
    return { escaping: out.slice(0, 12), contained: contained_out.slice(0, 4) };
  }, viewportWidth);
}

/** A heading is "wrapping vertically" when it is far taller than one line. */
async function stackedHeadings(page: Page) {
  return page.evaluate(() => {
    const out: { text: string; lines: number; width: number }[] = [];
    for (const el of Array.from(document.querySelectorAll('h1,h2,h3,h4,h5'))) {
      const r = el.getBoundingClientRect();
      if (r.height === 0) continue;
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 24;
      const lines = Math.round(r.height / lineHeight);
      const words = (el.textContent ?? '').trim().split(/\s+/).length;
      // One word per line is the reported symptom.
      if (lines >= 3 && lines >= words * 0.7) {
        out.push({ text: (el.textContent ?? '').trim().slice(0, 50), lines, width: Math.round(r.width) });
      }
    }
    return out;
  });
}

async function main() {
  const owner = await login('owner.admin@smoke-test-clinic.test');
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });

  console.log('\nG4.5d6 — MOBILE OVERFLOW AUDIT');
  console.log('='.repeat(78));

  let totalPagesBroken = 0;
  const summary: string[] = [];

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    await context.addInitScript(
      (a) => localStorage.setItem('kuwick-auth', JSON.stringify({ state: a, version: 0 })),
      {
        accessToken: owner.accessToken,
        refreshToken: owner.refreshToken,
        staff: owner.staff,
        tenant: owner.tenant,
      },
    );
    const page = await context.newPage();

    console.log(`\n--- ${vp.name} ${'-'.repeat(78 - vp.name.length - 5)}`);

    for (const route of ROUTES) {
      try {
        await page.goto(`${WEB}${route}`, { waitUntil: 'networkidle', timeout: 20_000 });
      } catch {
        await page.waitForTimeout(1500);
      }
      await page.waitForTimeout(700);

      const docWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const offenders = await overflowing(page, vp.width);
      const headings = await stackedHeadings(page);

      const scrollsSideways = docWidth > vp.width + 1;
      if (!scrollsSideways && offenders.escaping.length === 0 && headings.length === 0) {
        if (offenders.contained.length > 0) {
          console.log(
            `  OK    ${route}   (${offenders.contained.length} wide element(s) scroll inside their own box)`,
          );
          continue;
        }
        console.log(`  OK    ${route}`);
        continue;
      }
      totalPagesBroken += 1;
      console.log(`  BROKEN ${route}  (document ${docWidth}px vs viewport ${vp.width}px)`);
      const seen = new Set<string>();
      for (const o of offenders.escaping.slice(0, 8)) {
        const key = `${o.selector}|${o.width}`;
        if (seen.has(key)) continue;
        seen.add(key);
        console.log(`         wide  ${o.width}px  ${o.selector}  "${o.text}"`);
        summary.push(`${vp.width} ${route} ${o.selector} ${o.width}px`);
      }
      for (const h of headings) {
        console.log(`         title stacked over ${h.lines} lines in ${h.width}px: "${h.text}"`);
        summary.push(`${vp.width} ${route} HEADING ${h.lines} lines "${h.text}"`);
      }
    }
    await context.close();
  }

  await browser.close();
  console.log('\n' + '='.repeat(78));
  console.log(`Pages with a mobile layout fault: ${totalPagesBroken}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
