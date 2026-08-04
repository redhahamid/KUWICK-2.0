import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from 'dotenv';
import { chromium, Page } from 'playwright-core';

config({ path: join(__dirname, '..', '.env') });

// G4.5d3c-3b (D-095) — the eighteen approved queue/completion screenshots.
//
// Seed first:
//   KUWICK_ALLOW_FIXTURES=yes npx tsx prisma/g45d3c3b-queue-completion-check.ts --seed-only
//   npx tsx prisma/g45d3c3b-queue-shots.ts <billingVisitIdForShot18>
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium';
const API = 'http://localhost:3000';
const WEB = 'http://localhost:5173';
const OUT = join(__dirname, '..', '..', '..', 'docs', 'g45d3c3b-screenshots');

const DESKTOP = { width: 1440, height: 1000 };
const TABLET = { width: 834, height: 1112 };
const MOBILE = { width: 375, height: 812 };

const BILLING_VISIT = process.argv[2];

async function login(email: string) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'DevLocal!2026' }),
  });
  const body = (await res.json()) as Record<string, unknown>;
  if (!body.accessToken) throw new Error(`Login failed for ${email}`);
  return body;
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`  ${name}.png`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const frontDesk = await login('siti.front@smoke-test-clinic.test');
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  console.log(`\nG4.5d3c-3b screenshots -> ${OUT}`);
  console.log('='.repeat(70));

  const open = async (viewport: { width: number; height: number }, url: string) => {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    await context.addInitScript(
      (a) => localStorage.setItem('kuwick-auth', JSON.stringify({ state: a, version: 0 })),
      { accessToken: frontDesk.accessToken, refreshToken: frontDesk.refreshToken, staff: frontDesk.staff, tenant: frontDesk.tenant },
    );
    const page = await context.newPage();
    await page.goto(`${WEB}${url}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1600);
    return { page, context };
  };

  // On a narrow screen the tab strip scrolls, so a tab must be brought into
  // view before it is clicked — otherwise the click lands on the scroller and
  // the panel silently does not change.
  // On a narrow screen antd keeps a hidden copy of every overflowing tab in
  // its "more" menu, so the plain role query can resolve to an invisible node
  // whose click changes nothing. Take a visible one, scroll it in, click it.
  // On a narrow screen the tab strip scrolls, antd keeps a hidden copy of
  // every overflowing tab in its "more" menu, and a click landing mid-scroll
  // is swallowed. So: take a VISIBLE tab, scroll it in, let the strip settle,
  // click, and then VERIFY the panel actually activated before shooting.
  const tab = async (page: Page, label: string) => {
    const target = page.locator('.ant-tabs-tab').filter({ hasText: label }).locator('visible=true').first();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await target.scrollIntoViewIfNeeded().catch(() => undefined);
      await page.waitForTimeout(400);
      await target.click({ force: true }).catch(() => undefined);
      await page.waitForTimeout(700);
      const active = await page
        .locator('.ant-tabs-tab-active')
        .filter({ hasText: label })
        .count();
      if (active > 0) return;
    }
    throw new Error(`Tab "${label}" never activated`);
  };

  // 1–5, 6–10: desktop queue.
  {
    const { page, context } = await open(DESKTOP, '/queue');
    await shot(page, '01-desktop-queue-overview-stages');

    await tab(page, 'Waiting');
    await shot(page, '02-desktop-waiting-tab');

    await tab(page, 'Consultation');
    await shot(page, '03-desktop-consultation-tab-at-procedure');

    await tab(page, 'Dispensary');
    await shot(page, '04-desktop-dispensary-tab');

    await tab(page, 'Payment');
    await shot(page, '05-desktop-payment-tab-mixed-billing');

    // 6. An eligible Complete Visit action.
    const enabled = page.locator('button:enabled', { hasText: 'Complete Visit' });
    await enabled.first().scrollIntoViewIfNeeded().catch(() => undefined);
    await shot(page, '06-desktop-eligible-complete-visit-action');

    // 7. The confirmation summary.
    await enabled.first().click();
    await page.waitForTimeout(900);
    await shot(page, '07-desktop-complete-visit-confirmation');
    await page.keyboard.press('Escape');
    // Wait for the dialog to actually leave the DOM: its backdrop otherwise
    // swallows the next click and the expander reads as "not visible".
    await page.locator('.ant-modal-wrap').waitFor({ state: 'hidden' }).catch(() => undefined);
    await page.waitForTimeout(600);

    // 8/9. Blockers: expand a blocked payment row.
    const expanders = page.locator('.ant-table-row-expand-icon-collapsed').locator('visible=true');
    if (await expanders.count()) {
      await expanders.first().scrollIntoViewIfNeeded().catch(() => undefined);
      await expanders.first().click({ force: true });
      await page.waitForTimeout(800);
      await shot(page, '08-desktop-multiple-blocker-panel');
      await shot(page, '09-desktop-patient-balance-blocker');
    }
    await context.close();
  }

  // 10. Tariff-review blocker — the Payment row badged for review.
  {
    const { page, context } = await open(DESKTOP, '/queue');
    await tab(page, 'Payment');
    await shot(page, '10-desktop-tariff-review-blocker');
    await context.close();
  }

  // 11. Completed tab.
  {
    const { page, context } = await open(DESKTOP, '/queue');
    await tab(page, 'Completed');
    await shot(page, '11-desktop-completed-tab');
    await context.close();
  }

  // 12. Tablet overview.
  {
    const { page, context } = await open(TABLET, '/queue');
    await shot(page, '12-tablet-queue-overview');
    await context.close();
  }

  // 13–17. Mobile.
  {
    const { page, context } = await open(MOBILE, '/queue');
    await shot(page, '13-mobile-queue-tabs');

    await tab(page, 'Dispensary');
    await shot(page, '14-mobile-dispensary-row');

    await tab(page, 'Payment');
    await shot(page, '15-mobile-payment-row');

    const enabled = page.locator('button:enabled', { hasText: 'Complete Visit' });
    if (await enabled.count()) {
      await enabled.first().scrollIntoViewIfNeeded();
      await enabled.first().click();
      await page.waitForTimeout(900);
      await shot(page, '16-mobile-completion-confirmation');
      await page.keyboard.press('Escape');
      await page.locator('.ant-modal-wrap').waitFor({ state: 'hidden' }).catch(() => undefined);
      await page.waitForTimeout(600);
    }

    const expanders = page.locator('.ant-table-row-expand-icon-collapsed').locator('visible=true');
    if (await expanders.count()) {
      await expanders.first().scrollIntoViewIfNeeded().catch(() => undefined);
      await expanders.first().click({ force: true });
      await page.waitForTimeout(800);
      await shot(page, '17-mobile-blocker-panel');
    }
    await context.close();
  }

  // 18. Mobile Billing Review — corrected launcher spacing and visit-type control.
  if (BILLING_VISIT) {
    const { page, context } = await open(MOBILE, `/billing/visits/${BILLING_VISIT}`);
    await shot(page, '18-mobile-billing-review-widget-and-visit-type');

    // 55/56/57 — the floating launcher must not overlap any action.
    const overlap = await page.evaluate(() => {
      const launcher = document.querySelector('.kw-chat-launcher') as HTMLElement | null;
      if (!launcher) return { launcherVisible: false, overlaps: [] as string[] };
      const style = window.getComputedStyle(launcher);
      if (style.display === 'none' || style.visibility === 'hidden') return { launcherVisible: false, overlaps: [] };
      const lr = launcher.getBoundingClientRect();
      const overlaps: string[] = [];
      document.querySelectorAll('button').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        const hit = !(r.right < lr.left || r.left > lr.right || r.bottom < lr.top || r.top > lr.bottom);
        if (hit) overlaps.push((el.textContent ?? '').trim().slice(0, 40));
      });
      return { launcherVisible: true, overlaps };
    });
    console.log(`\n  chat launcher on mobile Billing Review: ${overlap.launcherVisible ? 'VISIBLE' : 'hidden'}`);
    console.log(`  overlapping buttons: ${overlap.overlaps.length === 0 ? 'none' : overlap.overlaps.join(', ')}`);
    await context.close();
  }

  // Overflow check at all three widths.
  console.log('\nHORIZONTAL OVERFLOW');
  for (const [name, viewport] of [['desktop', DESKTOP], ['tablet', TABLET], ['mobile', MOBILE]] as const) {
    const { page, context } = await open(viewport, '/queue');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    console.log(`  ${name.padEnd(8)} ${overflow ? 'OVERFLOWS' : 'no overflow'}`);
    await context.close();
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
