/**
 * SECTION 6 (cross-module workflows) and SECTION 7 (responsive).
 *
 * A WORKFLOW IS A SEQUENCE, not a screen. Each of the five below is captured as
 * consecutive frames a person can read in order, and each frame is a real state
 * of the product reached by navigating to it — the money and stock in them come
 * from the seeded clinic's own history, not from a fixture written to look good.
 *
 * Where a workflow's step has no screen (recording a panel remittance, for
 * instance) the sequence says so by omission and the inventory names the gap.
 */
import {
  DESKTOP, IPAD_LANDSCAPE, IPAD_PORTRAIT, CHROME, EMAIL, PASSWORD, WEB,
  ensureOut, open, pageShot, settle, shot, step, writeManifest, signIn, launch,
} from './harness';
import { chromium } from 'playwright-core';

async function main() {
  ensureOut();
  const { browser, page } = await launch();

  // =====================================================================
  // A. Invoice -> Payment -> Day-end -> Finance report
  // =====================================================================
  await pageShot(page, 'wfA-1-invoice-listing', '/admin/finance/invoices');
  await pageShot(page, 'wfA-2-payment-ledger', '/admin/finance/payments');
  await pageShot(page, 'wfA-3-day-end-same-money', '/admin/finance/day-end');
  await pageShot(page, 'wfA-4-finance-overview-rollup', '/admin/finance');

  // =====================================================================
  // B. Panel visit -> submission -> response -> re-claim -> reconciliation
  // =====================================================================
  await step('wfB-1-submission-queue', async () => {
    await open(page, '/admin/panel');
    await shot(page, 'wfB-1-submission-queue');
  });
  await step('wfB-2-work-queue-rejected', async () => {
    await open(page, '/admin/panel');
    await page.getByRole('button', { name: /Work queue/i }).click();
    await settle(page);
    await shot(page, 'wfB-2-work-queue-rejected');
  });
  await step('wfB-3-reclaim-chain', async () => {
    await open(page, '/admin/panel');
    await page.getByRole('button', { name: /Work queue/i }).click();
    await settle(page);
    await page.getByLabel('Include resolved').check();
    await settle(page);
    await page.locator('.ant-table-body, .ant-table-content').first()
      .evaluate((node) => node.scrollTo(node.scrollWidth, 0));
    await settle(page, 700);
    await shot(page, 'wfB-3-reclaim-chain');
  });
  await step('wfB-4-reconciliation', async () => {
    await open(page, '/admin/panel');
    await page.getByRole('button', { name: /Reconciliation/i }).click();
    await settle(page);
    await shot(page, 'wfB-4-reconciliation');
  });
  await pageShot(page, 'wfB-5-panel-receivable-in-finance', '/admin/finance/receivables');

  // =====================================================================
  // C. PO -> goods received -> ledger -> transfer -> receive -> balance
  // =====================================================================
  await pageShot(page, 'wfC-1-purchase-orders', '/admin/stock/purchase-orders');
  await pageShot(page, 'wfC-2-movement-ledger', '/admin/stock/movements');
  await pageShot(page, 'wfC-3-transfers', '/admin/stock/transfers');
  await step('wfC-4-receive-confirms-what-arrived', async () => {
    await open(page, '/admin/stock/transfers');
    await page.getByRole('button', { name: /^Receive$/ }).first().click();
    await page.getByRole('dialog').first().waitFor({ timeout: 15_000 });
    await settle(page, 600);
    await shot(page, 'wfC-4-receive-confirms-what-arrived', { viewport: true });
    await page.keyboard.press('Escape');
  });
  await pageShot(page, 'wfC-5-stock-balance-by-location', '/admin/stock/locations');

  // =====================================================================
  // D. Roster -> attendance -> leave -> payroll input
  // =====================================================================
  await pageShot(page, 'wfD-1-roster', '/admin/hr/roster');
  await pageShot(page, 'wfD-2-attendance', '/admin/hr/attendance');
  await pageShot(page, 'wfD-3-leave', '/admin/hr/leave');
  await step('wfD-4-payroll-reads-them', async () => {
    await open(page, '/admin/hr/payroll');
    await page.locator('.ant-table-tbody tr.ant-table-row').first().click();
    await settle(page, 900);
    await shot(page, 'wfD-4-payroll-reads-them');
  });

  // =====================================================================
  // E. Doctor work -> incentive run -> payroll
  // =====================================================================
  await pageShot(page, 'wfE-1-doctor-productivity', '/admin/operation/doctors');
  await pageShot(page, 'wfE-2-incentive-rules-and-runs', '/admin/hr/incentives');
  await step('wfE-3-incentive-run-detail', async () => {
    await open(page, '/admin/hr/incentives');
    await page.locator('.ant-table-tbody tr.ant-table-row').first().click();
    await settle(page, 900);
    await shot(page, 'wfE-3-incentive-run-detail');
  });
  await step('wfE-4-incentive-column-in-payroll', async () => {
    await open(page, '/admin/hr/payroll');
    await page.locator('.ant-table-tbody tr.ant-table-row').first().click();
    await settle(page, 900);
    await shot(page, 'wfE-4-incentive-column-in-payroll');
  });

  await browser.close();

  // =====================================================================
  // 7. RESPONSIVE — the nine screens the owner named, at three widths.
  // =====================================================================
  const RESPONSIVE: [string, string][] = [
    ['operation-overview', '/admin/operation'],
    ['stock-overview', '/admin/stock'],
    ['panel-work-queue', '/admin/panel'],
    ['hr-employee-directory', '/admin/hr/employees'],
    ['hr-payroll-run-detail', '/admin/hr/payroll'],
    ['hr-roster', '/admin/hr/roster'],
    ['finance-overview', '/admin/finance'],
    ['finance-day-end', '/admin/finance/day-end'],
    ['finance-outstanding', '/admin/finance/receivables'],
  ];

  for (const [label, viewport] of [
    ['desktop-1680', DESKTOP],
    ['ipad-landscape', IPAD_LANDSCAPE],
    ['ipad-portrait', IPAD_PORTRAIT],
  ] as [string, { width: number; height: number }][]) {
    const rb = await chromium.launch({ executablePath: CHROME });
    const ctx = await rb.newContext({ viewport, deviceScaleFactor: 2 });
    const rp = await ctx.newPage();
    await signIn(rp, EMAIL);
    for (const [name, route] of RESPONSIVE) {
      await step(`responsive-${label}--${name}`, async () => {
        await rp.goto(`${WEB}${route}`);
        await settle(rp);
        // The payroll run detail only exists once a run is opened.
        if (route.endsWith('/payroll')) {
          await rp.locator('.ant-table-tbody tr.ant-table-row').first().click().catch(() => {});
          await settle(rp, 800);
        }
        await shot(rp, `responsive-${label}--${name}`);
      });
    }
    await rb.close();
  }

  writeManifest('manifest-05-workflows-responsive.json');
}

void PASSWORD;
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
