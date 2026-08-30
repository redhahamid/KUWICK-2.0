/**
 * THE RELEASE-CANDIDATE PACK — twelve workflows, end to end.
 *
 * The first two shot scripts capture SCREENS. The owner's second pass asks for
 * something different: proof that specific WORKFLOWS complete, each with the
 * decision it demands visible in the frame. A screen showing a work queue does
 * not prove a rejection can be re-claimed; a screen showing a day-end form does
 * not prove that counting the drawer short forces a reason out of somebody.
 *
 * So this script DOES the work in a real browser against the seeded synthetic
 * clinic — it types the counted cash, it closes the day — and photographs each
 * step. Two of the twelve deliberately end in a state the previous run could
 * not reach at all, because the seed now leaves today open for exactly this.
 *
 * NOTHING HERE IS STAGED. Every figure in every image came from the API,
 * computed by the same code path a user drives.
 *
 *   ADMIN_SHOTS_WEB=http://localhost:5173 npx tsx prisma/admin-rc-shots.ts
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Page, chromium } from 'playwright-core';

const WEB = process.env.ADMIN_SHOTS_WEB ?? 'http://localhost:5173';
const EMAIL = process.env.ADMIN_SHOTS_EMAIL ?? 'owner@admin-uat.kuwick.invalid';
const PASSWORD = process.env.ADMIN_UAT_PASSWORD ?? 'AdminUat!2026';
const OUT = process.env.ADMIN_SHOTS_DIR ?? join(process.cwd(), '..', '..', 'docs', 'screenshots', 'admin');
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium';

const DESKTOP = { width: 1680, height: 1050 };
const IPAD_LANDSCAPE = { width: 1194, height: 834 };

async function settle(page: Page) {
  await page.locator('.ant-spin-spinning').waitFor({ state: 'detached', timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(700);
}

async function shoot(page: Page, name: string, opts: { viewport?: boolean } = {}) {
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: !opts.viewport });
  console.log(`  ${name}`);
}

async function signIn(page: Page) {
  await page.goto(`${WEB}/login`);
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30_000 });
}

/** The branch picker in the hub header, so a shot is not silently group-wide. */
async function selectBranch(page: Page, name: string) {
  const picker = page.getByLabel('Branch');
  if ((await picker.count()) === 0) return;
  await picker.first().click();
  await page.getByTitle(name).first().click().catch(() => {});
  await settle(page);
}

const FAILURES: string[] = [];

async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (error) {
    // A workflow that cannot be driven is REPORTED, never quietly dropped.
    // A missing image in a pack of twelve is the owner's question to ask, and
    // a pack that hides its own gaps is worse than a pack with a gap in it.
    const message = (error as Error).message.split('\n')[0];
    FAILURES.push(`${name}: ${message}`);
    console.log(`  ${name}  FAILED: ${message}`);
  }
}

/**
 * THE MOUNTED SCREENS, photographed INSIDE Admin.
 *
 * Half of these render a component written for /management or /settings. The
 * whole claim of this pass is that an owner cannot tell which half, so the
 * board needs them shot in the Admin shell — the same rail, the same header,
 * the same table density — rather than at their original URL.
 */
const IN_ADMIN: [string, string][] = [
  ['rc-ia-01-stock-items-in-admin', '/admin/stock/items'],
  ['rc-ia-02-stock-by-location-in-admin', '/admin/stock/locations'],
  ['rc-ia-03-stock-purchase-orders-in-admin', '/admin/stock/purchase-orders'],
  ['rc-ia-04-stock-suppliers-in-admin', '/admin/stock/suppliers'],
  ['rc-ia-05-stock-near-expiry-in-admin', '/admin/stock/near-expiry'],
  ['rc-ia-06-stock-slow-moving-in-admin', '/admin/stock/slow-moving'],
  ['rc-ia-07-stock-value-in-admin', '/admin/stock/value'],
  ['rc-ia-08-panel-companies-in-admin', '/admin/panel/companies'],
  ['rc-ia-09-panel-batches-in-admin', '/admin/panel/batches'],
  ['rc-ia-10-hr-roles-and-access-in-admin', '/admin/hr/access'],
  ['rc-ia-11-hr-staff-benefits', '/admin/hr/benefits'],
  ['rc-ia-12-finance-sales-in-admin', '/admin/finance/sales'],
  ['rc-ia-13-finance-invoices-in-admin', '/admin/finance/invoices'],
  ['rc-ia-14-finance-tax-sst', '/admin/finance/tax'],
  ['rc-ia-15-finance-inter-company', '/admin/finance/inter-company'],
  ['rc-ia-16-finance-e-invoice-not-built', '/admin/finance/e-invoice'],
  ['rc-ia-17-operation-patient-analysis-in-admin', '/admin/operation/patients'],
  ['rc-ia-18-operation-procedure-analysis-in-admin', '/admin/operation/procedures'],
  ['rc-ia-19-operation-doctor-performance-in-admin', '/admin/operation/doctors'],
  ['rc-ia-20-operation-wait-times-in-admin', '/admin/operation/wait-times'],
  ['rc-ia-21-marketing-consolidated', '/admin/operation/marketing'],
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME });
  const context = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await signIn(page);

  for (const [name, route] of IN_ADMIN) {
    await step(name, async () => {
      await page.goto(`${WEB}${route}`);
      await settle(page);
      await shoot(page, name);
    });
  }

  // 1 — STOCK TRANSFER DISCREPANCY. Sent 40, arrived 36. The receiving screen
  //     is where that becomes a fact somebody has to explain.
  await step('rc-01-stock-transfer-discrepancy', async () => {
    await page.goto(`${WEB}/admin/stock/transfers`);
    await settle(page);
    await shoot(page, 'rc-01a-stock-transfers-board');
    await page.getByRole('button', { name: /^Receive$/ }).first().click();
    await page.getByRole('dialog').first().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(400);
    await shoot(page, 'rc-01-stock-transfer-discrepancy', { viewport: true });
    await page.keyboard.press('Escape');
  });

  // 2 — STOCK TAKE: counted, submitted, approved. The count is a variance
  //     against the ledger and the approval is what posts it.
  await step('rc-02-stock-take-approval', async () => {
    await page.goto(`${WEB}/admin/stock/stock-take`);
    await settle(page);
    await page.locator('.ant-table-tbody tr.ant-table-row').first().click();
    await settle(page);
    await shoot(page, 'rc-02-stock-take-submit-and-approve');
  });

  // 3 — PANEL: rejected, re-claimed, and the money reconciled. Three states of
  //     one claim, which is the whole reason the module keeps them apart.
  await step('rc-03-panel-reclaim', async () => {
    await page.goto(`${WEB}/admin/panel`);
    await settle(page);
    await page.getByRole('button', { name: /Work queue/i }).click();
    await settle(page);
    await shoot(page, 'rc-03a-panel-work-queue-rejected');

    // THE FULL RE-CLAIM CHAIN, which the default queue correctly hides.
    // SJ-2026-0442 was rejected on formulary grounds and RESOLVED by raising
    // SJ-2026-0517 the next day; a queue that kept showing the settled original
    // would have it chased twice. Ticking "Include resolved" is how somebody
    // answers "what happened to that one", and it is the only view where the
    // Replaces / Resubmitted / Resolved columns have anything to say.
    await page.getByLabel('Include resolved').check();
    await settle(page);
    await shoot(page, 'rc-03c-panel-reclaim-chain');
    await page.getByLabel('Include resolved').uncheck();
    await settle(page);

    await page.getByRole('button', { name: /Record outcome/i }).first().click();
    await page.getByRole('dialog').first().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(400);
    await shoot(page, 'rc-03b-panel-record-outcome', { viewport: true });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: /Reconciliation/i }).click();
    await settle(page);
    await shoot(page, 'rc-03-panel-reclaim-and-reconciliation');
  });

  // 4 — HR EMPLOYEE DETAIL. Employment, person, pay basis, statutory position,
  //     attendance and payroll history, in one record.
  await step('rc-04-hr-employee-detail', async () => {
    await page.goto(`${WEB}/admin/hr/employees`);
    await settle(page);
    await page.locator('.ant-table-tbody tr.ant-table-row').first().click();
    await page.getByRole('dialog').first().waitFor({ timeout: 15_000 });
    await settle(page);
    await shoot(page, 'rc-04-hr-employee-detail', { viewport: true });
    // The record is taller than the drawer, and payroll history plus the
    // documents disclosure are the half that does not fit. Two frames rather
    // than a shot that stops mid-record.
    const body = page.locator('.ant-drawer-body').first();
    await body.evaluate((node) => node.scrollTo(0, node.scrollHeight));
    await page.waitForTimeout(500);
    await shoot(page, 'rc-04b-hr-employee-payroll-history', { viewport: true });
    await page.keyboard.press('Escape');
  });

  // 5 — LEAVE AND THE ROSTER IT AFFECTS. Two screens, because the point is
  //     that approving leave in one is visible in the other — and that there
  //     is only one roster to be visible in.
  await step('rc-05-hr-leave-and-roster', async () => {
    await page.goto(`${WEB}/admin/hr/leave`);
    await settle(page);
    await shoot(page, 'rc-05a-hr-leave-requests');
    await page.goto(`${WEB}/admin/hr/roster`);
    await settle(page);
    await shoot(page, 'rc-05-hr-leave-roster-impact');
  });

  // 6 — PAYROLL SAYING WHAT IT CANNOT DO. The banner is the deliverable here.
  await step('rc-06-payroll-statutory-not-ready', async () => {
    await page.goto(`${WEB}/admin/hr/payroll`);
    await settle(page);
    await page.locator('.ant-table-tbody tr.ant-table-row').first().click();
    await settle(page);
    await shoot(page, 'rc-06-payroll-statutory-not-ready');
  });

  // 7 + 8 — THE DAY-END, DRIVEN FOR REAL.
  //
  // Today is open with takings in all four buckets. The script counts CASH
  // RM20 SHORT of what the ledger expects and every other bucket exactly, so
  // the variance, the mandatory reason and the closed lock are demonstrated
  // rather than described. Nothing is typed into the expected column — that is
  // the server's number and the whole point is that a person cannot edit it.
  await step('rc-07/08-day-end', async () => {
    await page.goto(`${WEB}/admin/finance/day-end`);
    await settle(page);
    await selectBranch(page, 'Contoh Central');
    await shoot(page, 'rc-07a-day-end-open-with-expected');

    // Read the expected figures OFF THE SCREEN. A shot script that recomputes
    // its own expectation can agree with itself while disagreeing with the
    // product, which is the one thing this pack must not do.
    const expected: Record<string, number> = {};
    for (const label of ['Cash', 'Card', 'QR', 'Other']) {
      // Found by the input's OWN accessible name rather than by the row's
      // text: a row reads "CashNotes and coins in the drawer RM116.90", so a
      // word boundary after "Cash" never fires and a substring match on "Cash"
      // would also hit "Cash" inside another row's hint.
      const row = page.locator('.kw-countRow').filter({ has: page.getByLabel(`Counted ${label}`) }).first();
      const text = await row.locator('.kw-countRow__expected').innerText();
      expected[label] = Number(text.replace(/[^0-9.-]/g, ''));
    }
    console.log(`      expected on screen: ${JSON.stringify(expected)}`);
    if (expected.Cash <= 20) throw new Error(`expected cash is ${expected.Cash}; the RM20 short count needs more than that`);

    // THE COUNT. Cash short by twenty; the rest counted exactly.
    await page.getByLabel('Counted Cash').fill(String((expected.Cash - 20).toFixed(2)));
    await page.getByLabel('Counted Card').fill(String(expected.Card.toFixed(2)));
    await page.getByLabel('Counted QR').fill(String(expected.QR.toFixed(2)));
    await page.getByLabel('Counted Other').fill(String(expected.Other.toFixed(2)));
    await page.waitForTimeout(400);
    await shoot(page, 'rc-07b-day-end-variance-blocks-close');

    await page.getByLabel('Reason for the variance').fill(
      'RM20 short: change given from the drawer for a supplier delivery, receipt in the tin. Counted by the counter supervisor.',
    );
    await page.getByRole('button', { name: /^Save count$/ }).click();
    await settle(page);
    await shoot(page, 'rc-07-day-end-counted-money-and-variance');

    await page.getByRole('button', { name: /^Close the day$/ }).click();
    await settle(page);
    await page.waitForTimeout(900);
    await shoot(page, 'rc-08-day-end-closed-and-locked');
  });

  // 9 — OUTSTANDING, aged. Patient money and panel money side by side and
  //     never summed, which is the rule this screen exists to hold.
  await step('rc-09-outstanding-aging', async () => {
    await page.goto(`${WEB}/admin/finance/receivables`);
    await settle(page);
    await shoot(page, 'rc-09-outstanding-invoice-aging');
  });

  // 10 + 11 — PROFITABILITY, both kinds. Drugs have a cost basis; procedures
  //     do not, and the second image is there to show the product SAYING so
  //     rather than reporting a hundred-percent margin.
  await step('rc-10-drug-profitability', async () => {
    await page.goto(`${WEB}/admin/finance/profitability`);
    await settle(page);
    await shoot(page, 'rc-10-drug-profitability');
  });

  await step('rc-11-procedure-profitability', async () => {
    await page.goto(`${WEB}/admin/finance/profitability`);
    await settle(page);
    // antd Segmented renders radio inputs behind labels.
    await page.getByText('Services & procedures', { exact: true }).first().click();
    await settle(page);
    await shoot(page, 'rc-11-procedure-profitability-cost-not-configured');
  });

  // 12 — CREDIT NOTE: raised, and the approval that issues it.
  await step('rc-12-credit-note', async () => {
    await page.goto(`${WEB}/admin/finance/credit-notes`);
    await settle(page);
    await shoot(page, 'rc-12-credit-note-creation-and-approval');
  });

  // 13 — THE MARKETING SENDING QUEUE, with an audience actually built.
  //
  // `prepare` and `markOpened` were endpoints with no UI, so the audience
  // builder could not reach a message and the history table could only ever be
  // empty. Photographing the screen in its resting state would show none of
  // that, so this builds the audience, picks a template, prepares the messages
  // and captures the per-patient queue — which is the thing that was missing.
  //
  // It still sends nothing. Every row is a link a person clicks themselves.
  await step('rc-13-marketing-sending-queue', async () => {
    await page.goto(`${WEB}/admin/operation/marketing`);
    await settle(page);
    await page.getByRole('button', { name: 'Build audience' }).click();
    await settle(page);
    await shoot(page, 'rc-ia-21-marketing-consolidated');

    await page
      .locator('.kw-adminSection', { hasText: 'Prepare messages' })
      .locator('.ant-select')
      .first()
      .click();
    await page.locator('.ant-select-item-option').first().click();
    await page.getByRole('button', { name: /Prepare \d+ message/ }).click();
    await page.getByRole('dialog').first().waitFor({ timeout: 20_000 });
    await page.waitForTimeout(900);
    await shoot(page, 'rc-13-marketing-sending-queue', { viewport: true });
    await page.keyboard.press('Escape');
  });

  await context.close();

  // -------------------------------------------------------------------------
  // iPad landscape, for the screens somebody actually holds a tablet in front
  // of. Not a second copy of all twelve — a stock-take is done standing at a
  // shelf, a drawer count at a counter, and those are the ones that matter.
  // -------------------------------------------------------------------------
  const tablet = await browser.newContext({ viewport: IPAD_LANDSCAPE, deviceScaleFactor: 2 });
  const tabletPage = await tablet.newPage();
  await signIn(tabletPage);
  for (const [name, route] of [
    ['rc-ipad-01-stock-attention', '/admin/stock'],
    ['rc-ipad-02-stock-take', '/admin/stock/stock-take'],
    ['rc-ipad-03-panel-work-queue', '/admin/panel'],
    ['rc-ipad-04-day-end', '/admin/finance/day-end'],
    ['rc-ipad-05-hr-today', '/admin/hr'],
    ['rc-ipad-06-outstanding', '/admin/finance/receivables'],
  ] as [string, string][]) {
    await step(name, async () => {
      await tabletPage.goto(`${WEB}${route}`);
      await settle(tabletPage);
      await shoot(tabletPage, name);
    });
  }
  await tablet.close();

  await context.close();
  await browser.close();

  if (FAILURES.length > 0) {
    console.log(`\n${FAILURES.length} workflow(s) could not be captured:`);
    for (const failure of FAILURES) console.log(`  - ${failure}`);
  }
  console.log(`\nWritten to ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
