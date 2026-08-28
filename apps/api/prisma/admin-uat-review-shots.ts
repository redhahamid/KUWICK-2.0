/**
 * THE OWNER REVIEW PACK — the screens the contact sheets are built from.
 *
 * `admin-uat-shots.ts` captures the twenty Admin pages. This adds what the
 * owner asked to see that those twenty do not cover:
 *
 *   - MODAL AND DETAIL STATES. A workflow screen is half a screen until you
 *     can see the decision it asks for: receiving a transfer, recording what
 *     a panel said, re-claiming a rejection, opening a stock take.
 *   - SCREENS THAT LIVE IN THE EXISTING MANAGEMENT MODULE. Item pricing,
 *     stock levels, purchase orders, leave, roles, the roster, the sales
 *     report and drug movement are all pre-existing pages this branch did not
 *     build and did not change. They are captured against the SAME synthetic
 *     clinic so the boards read as one system, and the review pack labels
 *     which module owns each one so nothing is claimed that was not built.
 *
 *   ADMIN_SHOTS_WEB=http://localhost:5173 npx tsx prisma/admin-uat-review-shots.ts
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Page, chromium } from 'playwright-core';

const WEB = process.env.ADMIN_SHOTS_WEB ?? 'http://localhost:5173';
const EMAIL = process.env.ADMIN_SHOTS_EMAIL ?? 'owner@admin-uat.kuwick.invalid';
const PASSWORD = process.env.ADMIN_UAT_PASSWORD ?? 'AdminUat!2026';
const OUT = process.env.ADMIN_SHOTS_DIR ?? join(process.cwd(), '..', '..', 'docs', 'screenshots', 'admin');
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium';

/** Plain page captures — name, route. */
const PAGES: [string, string][] = [
  // STOCK, from the existing Management module.
  ['stock-05-items-and-pricing', '/management/stock/items'],
  ['stock-06-levels-by-branch', '/management/stock/levels'],
  ['stock-07-purchase-orders', '/management/stock/purchase-orders'],
  // HR, from Settings and Management.
  ['hr-06-roles-and-permissions', '/settings/organisation/roles'],
  ['hr-07-leave-requests', '/management/hr/leave-requests'],
  ['hr-08-provider-roster', '/settings/scheduling/provider-availability'],
  // FINANCE, from the existing reports module.
  ['finance-06-sales-report', '/management/reports/sales'],
  ['finance-07-drug-movement', '/management/reports/drug-movement'],
  ['finance-08-invoice-listing', '/management/reports/invoices'],
];

/** Captures that need a click first — name, route, what to open. */
const INTERACTIONS: { name: string; route: string; open: (page: Page) => Promise<void> }[] = [
  {
    name: 'stock-09-receive-transfer-modal',
    route: '/admin/stock/transfers',
    open: async (page) => {
      await page.getByRole('button', { name: /^Receive$/ }).first().click();
      await page.getByRole('dialog').first().waitFor({ timeout: 15_000 });
    },
  },
  {
    name: 'stock-10-stock-take-detail',
    route: '/admin/stock/stock-take',
    open: async (page) => {
      await page.locator('.ant-table-tbody tr.ant-table-row').first().click();
      await page.waitForTimeout(800);
    },
  },
  {
    name: 'panel-05-adjudicate-claim',
    route: '/admin/panel',
    open: async (page) => {
      await page.getByRole('button', { name: /Work queue/i }).click();
      await page.locator('.ant-spin-spinning').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {});
      await page.getByRole('button', { name: /Record outcome/i }).first().click();
      await page.getByRole('dialog').first().waitFor({ timeout: 15_000 });
    },
  },
  {
    // The rejected claim in the seeded data has ALREADY been re-claimed, so the
    // workspace correctly hides its Re-claim button — a second replacement for
    // one rejection is the same money claimed twice. What the board offers on
    // that row instead is the write-off, which is the other end of the same
    // decision: pursue it again, or stop pursuing it and say why.
    name: 'panel-06-write-off-receivable',
    route: '/admin/panel',
    open: async (page) => {
      await page.getByRole('button', { name: /Work queue/i }).click();
      await page.locator('.ant-spin-spinning').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {});
      await page.getByRole('button', { name: /Write off/i }).first().click();
      await page.getByRole('dialog').first().waitFor({ timeout: 15_000 });
    },
  },
  {
    name: 'panel-07-mark-submitted',
    route: '/admin/panel',
    open: async (page) => {
      await page.getByRole('button', { name: /Mark submitted/i }).first().click();
      await page.getByRole('dialog').first().waitFor({ timeout: 15_000 });
    },
  },
  {
    name: 'hr-09-payroll-run-detail',
    route: '/admin/hr/payroll',
    open: async (page) => {
      await page.locator('.ant-table-tbody tr.ant-table-row').first().click();
      await page.waitForTimeout(900);
    },
  },
  {
    name: 'hr-10-incentive-run-detail',
    route: '/admin/hr/incentives',
    open: async (page) => {
      await page.locator('.ant-table-tbody tr.ant-table-row').first().click();
      await page.waitForTimeout(900);
    },
  },
];

async function settle(page: Page) {
  await page.locator('.ant-spin-spinning').waitFor({ state: 'detached', timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(700);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });
  const context = await browser.newContext({ viewport: { width: 1680, height: 1050 }, deviceScaleFactor: 2 });
  const page = await context.newPage();

  await page.goto(`${WEB}/login`);
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30_000 });

  for (const [name, route] of PAGES) {
    await page.goto(`${WEB}${route}`);
    await settle(page);
    await page.screenshot({ path: join(OUT, `desktop--${name}.png`), fullPage: true });
    console.log(`  ${name}`);
  }

  for (const shot of INTERACTIONS) {
    await page.goto(`${WEB}${shot.route}`);
    await settle(page);
    try {
      await shot.open(page);
      await page.waitForTimeout(500);
      // Modals are viewport-anchored; a fullPage shot of one is mostly overlay.
      await page.screenshot({ path: join(OUT, `desktop--${shot.name}.png`), fullPage: !shot.name.includes('modal') });
      console.log(`  ${shot.name}`);
    } catch (error) {
      // An interaction that cannot be reached is reported, not silently
      // skipped — a missing board tile is the owner's question to ask.
      console.log(`  ${shot.name}  SKIPPED: ${(error as Error).message.split('\n')[0]}`);
    }
  }

  await context.close();
  await browser.close();
  console.log(`\nWritten to ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
