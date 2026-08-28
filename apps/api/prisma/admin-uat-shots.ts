/**
 * THE UAT SCREENSHOT SET — one image per thing worth looking at.
 *
 * The brief asks for a representative set and explicitly not fifty
 * near-identical pictures, so this captures each module's landing page (the
 * question it answers), the workflows that change money or stock, and the
 * three widths the responsive pass covers. Anything that would differ only by
 * a row of data is left out.
 *
 * Runs against a server already up, with the synthetic admin tenant seeded:
 *   ADMIN_SHOTS_WEB=http://localhost:5173 npx tsx prisma/admin-uat-shots.ts
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const WEB = process.env.ADMIN_SHOTS_WEB ?? 'http://localhost:5173';
const EMAIL = process.env.ADMIN_SHOTS_EMAIL ?? 'owner@admin-uat.kuwick.invalid';
const PASSWORD = process.env.ADMIN_UAT_PASSWORD ?? 'AdminUat!2026';
const OUT = process.env.ADMIN_SHOTS_DIR ?? join(process.cwd(), '..', '..', 'docs', 'screenshots', 'admin');
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium';

/** name → route. The name is the filename, so it has to say what it shows. */
const DESKTOP: [string, string][] = [
  // OPERATIONS — the performance picture, its configuration, and the two
  // screens that are most tempting to over-claim.
  ['operation-01-overview', '/admin/operation'],
  ['operation-02-segment-pl', '/admin/operation/segments'],
  ['operation-03-programmes', '/admin/operation/programmes'],
  ['operation-04-marketing', '/admin/operation/marketing'],

  // STOCK — what needs attention, the two controlled workflows, the ledger.
  ['stock-01-what-needs-attention', '/admin/stock'],
  ['stock-02-transfers', '/admin/stock/transfers'],
  ['stock-03-stock-take', '/admin/stock/stock-take'],
  ['stock-04-movement-ledger', '/admin/stock/movements'],

  // PANEL — the submission queue, the work queue, the reconciliation, and the
  // per-panel rules that drive all three.
  ['panel-01-to-submit', '/admin/panel'],
  ['panel-02-configuration', '/admin/panel/configuration'],

  // HR — today, the directory, the timesheet, and payroll refusing to guess.
  ['hr-01-today', '/admin/hr'],
  ['hr-02-employees', '/admin/hr/employees'],
  ['hr-03-timesheets', '/admin/hr/attendance'],
  ['hr-04-payroll', '/admin/hr/payroll'],
  ['hr-05-incentives', '/admin/hr/incentives'],

  // FINANCE — did yesterday reconcile, the drawer, the money, what is owed.
  ['finance-01-overview', '/admin/finance'],
  ['finance-02-day-end', '/admin/finance/day-end'],
  ['finance-03-payments', '/admin/finance/payments'],
  ['finance-04-outstanding', '/admin/finance/receivables'],
  ['finance-05-credit-notes', '/admin/finance/credit-notes'],
];

/** The panel workspace's other two views, which are the same route. */
const PANEL_VIEWS: [string, string][] = [
  ['panel-03-work-queue', 'Work queue'],
  ['panel-04-reconciliation', 'Reconciliation'],
];

/**
 * Tablet is not a second set of twenty. Four screens, chosen because they are
 * the ones a person actually holds a tablet in front of: the two exception
 * boards, the densest table, and the drawer count.
 */
const TABLET: [string, string][] = [
  ['stock-01-what-needs-attention', '/admin/stock'],
  ['panel-01-to-submit', '/admin/panel'],
  ['finance-04-outstanding', '/admin/finance/receivables'],
  ['finance-02-day-end', '/admin/finance/day-end'],
];

const VIEWPORTS = {
  desktop: { width: 1680, height: 1050 },
  'ipad-landscape': { width: 1194, height: 834 },
  'ipad-portrait': { width: 834, height: 1194 },
} as const;

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });

  for (const [label, size] of Object.entries(VIEWPORTS)) {
    const routes = label === 'desktop' ? DESKTOP : TABLET;
    const context = await browser.newContext({ viewport: size, deviceScaleFactor: 2 });
    const page = await context.newPage();

    await page.goto(`${WEB}/login`);
    await page.getByLabel(/email/i).fill(EMAIL);
    await page.getByLabel(/password/i).fill(PASSWORD);
    await page.getByRole('button', { name: /sign in|log in/i }).click();
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30_000 });

    for (const [name, route] of routes) {
      await page.goto(`${WEB}${route}`);
      await page.locator('.kw-admin').waitFor({ timeout: 30_000 });
      await page.locator('.ant-spin-spinning').waitFor({ state: 'detached', timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(600);
      const file = join(OUT, `${label}--${name}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log(`  ${label}  ${name}`);
    }

    // The panel workspace's other two views, desktop only — they are the same
    // route with a different question, and both are worth seeing.
    if (label === 'desktop') {
      await page.goto(`${WEB}/admin/panel`);
      await page.locator('.kw-admin').waitFor({ timeout: 30_000 });
      for (const [name, button] of PANEL_VIEWS) {
        await page.getByRole('button', { name: new RegExp(button, 'i') }).click();
        await page.locator('.ant-spin-spinning').waitFor({ state: 'detached', timeout: 30_000 }).catch(() => {});
        await page.waitForTimeout(600);
        await page.screenshot({ path: join(OUT, `${label}--${name}.png`), fullPage: true });
        console.log(`  ${label}  ${name}`);
      }
    }

    await context.close();
  }

  await browser.close();
  console.log(`\nWritten to ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
