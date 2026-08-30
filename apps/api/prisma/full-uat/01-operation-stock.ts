/**
 * SECTION 1 (Operation) and SECTION 2 (Stock) of the owner's visual UAT list.
 *
 * Every page individually, plus the modals and drill-downs each one owns. Where
 * the owner named a screen that does not exist as its own page — "low stock",
 * "negative dispensing", "price changes" — this script captures what the
 * product actually has and the inventory records the difference. Inventing a
 * screen to satisfy a list is the one thing worse than a gap.
 */
import { ensureOut, launch, open, pageShot, settle, shot, step, writeManifest } from './harness';

async function main() {
  ensureOut();
  const { browser, page } = await launch();

  // =====================================================================
  // 1. OPERATION
  // =====================================================================
  await pageShot(page, '01-operation-overview', '/admin/operation');

  // The period presets are the filter this dashboard is actually driven by.
  // They are Buttons, not a Segmented/radio group, and the set is
  // Today / This month / This quarter / Custom — there is no "This year".
  await step('02-operation-overview-period-filter', async () => {
    await open(page, '/admin/operation');
    await page.getByRole('button', { name: 'This quarter', exact: true }).click();
    await settle(page);
    await shot(page, '02-operation-overview-period-filter');
  });

  await pageShot(page, '03-operation-segment-pnl', '/admin/operation/segments');
  await pageShot(page, '04-operation-programmes', '/admin/operation/programmes');
  await pageShot(page, '05-operation-marketing-empty', '/admin/operation/marketing');

  // THE AUDIENCE BUILDER, built. The screen is a form until somebody uses it.
  await step('06-operation-marketing-audience-built', async () => {
    await open(page, '/admin/operation/marketing');
    await page.getByRole('button', { name: 'Build audience' }).click();
    await settle(page);
    await shot(page, '06-operation-marketing-audience-built');
  });

  // THE PREPARED MESSAGE QUEUE — the capability that had no UI at all until
  // this branch. Reaching it needs an audience and a template first.
  await step('07-operation-marketing-prepared-queue', async () => {
    await open(page, '/admin/operation/marketing');
    await page.getByRole('button', { name: 'Build audience' }).click();
    await settle(page);
    await page.locator('.kw-adminSection', { hasText: 'Prepare messages' }).locator('.ant-select').first().click();
    await page.locator('.ant-select-item-option').first().click();
    await page.getByRole('button', { name: /Prepare \d+ message/ }).click();
    await page.getByRole('dialog').first().waitFor({ timeout: 20_000 });
    await settle(page, 900);
    await shot(page, '07-operation-marketing-prepared-queue', { viewport: true });
    await page.keyboard.press('Escape');
  });

  // The four analysis screens Operation mounts from the reports module.
  await pageShot(page, '08-operation-patient-analysis', '/admin/operation/patients');
  await pageShot(page, '09-operation-procedure-analysis', '/admin/operation/procedures');
  await pageShot(page, '10-operation-doctor-performance', '/admin/operation/doctors');
  await pageShot(page, '11-operation-waiting-times', '/admin/operation/wait-times');

  // =====================================================================
  // 2. STOCK
  // =====================================================================
  await pageShot(page, '12-stock-attention-board', '/admin/stock');

  // The attention board is a set of exception VIEWS. Each tile is the filter,
  // and the owner asked for low stock / negative / expiry individually — they
  // are these, not separate pages.
  for (const [name, tile] of [
    ['13-stock-view-below-minimum', 'Below minimum'],
    ['14-stock-view-negative', 'Negative stock'],
    ['15-stock-view-expired', 'Expired'],
  ] as [string, string][]) {
    await step(name, async () => {
      await open(page, '/admin/stock');
      await page.locator('.kw-exceptionTile', { hasText: tile }).first().click();
      await settle(page);
      await shot(page, name);
    });
  }

  await pageShot(page, '16-stock-near-expiry', '/admin/stock/near-expiry');
  await pageShot(page, '17-stock-slow-moving', '/admin/stock/slow-moving');
  await pageShot(page, '18-stock-valuation', '/admin/stock/value');
  await pageShot(page, '19-stock-by-location', '/admin/stock/locations');
  await pageShot(page, '20-stock-item-catalogue-pricing', '/admin/stock/items');

  // Item create and edit — the owner asked for both.
  await step('21-stock-item-create', async () => {
    await open(page, '/admin/stock/items');
    await page.getByRole('button', { name: /Add Item/i }).click();
    await page.getByRole('dialog').first().waitFor({ timeout: 15_000 });
    await settle(page, 600);
    await shot(page, '21-stock-item-create', { viewport: true });
    await page.keyboard.press('Escape');
  });

  await step('22-stock-item-edit', async () => {
    await open(page, '/admin/stock/items');
    await page.getByRole('button', { name: /^Edit$/ }).first().click();
    await page.getByRole('dialog').first().waitFor({ timeout: 15_000 });
    await settle(page, 600);
    await shot(page, '22-stock-item-edit', { viewport: true });
    await page.keyboard.press('Escape');
  });

  await pageShot(page, '23-stock-suppliers', '/admin/stock/suppliers');
  await pageShot(page, '24-stock-movement-ledger', '/admin/stock/movements');
  await pageShot(page, '25-stock-transfers-list', '/admin/stock/transfers');

  // RECEIVING A TRANSFER is where a discrepancy becomes a fact somebody has to
  // explain. The seeded transfer was sent 40 and arrived 36.
  await step('26-stock-transfer-receive-modal', async () => {
    await open(page, '/admin/stock/transfers');
    await page.getByRole('button', { name: /^Receive$/ }).first().click();
    await page.getByRole('dialog').first().waitFor({ timeout: 15_000 });
    await settle(page, 600);
    await shot(page, '26-stock-transfer-receive-modal', { viewport: true });
    await page.keyboard.press('Escape');
  });

  await pageShot(page, '27-stock-take-list', '/admin/stock/stock-take');

  // The stock-take detail is the count → recount → submit → approve → post
  // chain. Opening a row is what shows the variance per line.
  await step('28-stock-take-count-detail', async () => {
    await open(page, '/admin/stock/stock-take');
    await page.locator('.ant-table-tbody tr.ant-table-row').first().click();
    await settle(page, 900);
    await shot(page, '28-stock-take-count-detail');
  });

  // THE COUNT STILL IN PROGRESS, which is the half of the chain a POSTED take
  // cannot show: lines not yet counted, a variance with a typed reason, and the
  // progress bar short of full. It is a separate take at the SAME branch — the
  // owner account is bound to Contoh Central, so a take at Bandar is not
  // reachable from it and would have made this capture a picture of the
  // posted one under an in-progress name.
  await step('28b-stock-take-counting-in-progress', async () => {
    await open(page, '/admin/stock/stock-take');
    await shot(page, '28b-stock-take-counting-in-progress');
  });

  await step('28c-stock-take-counting-detail', async () => {
    await open(page, '/admin/stock/stock-take');
    await page
      .locator('.ant-table-tbody tr.ant-table-row', { hasText: 'Month-end count' })
      .first()
      .click({ timeout: 8_000 });
    await settle(page, 900);
    await shot(page, '28c-stock-take-counting-detail');
  });

  await pageShot(page, '29-stock-purchase-orders', '/admin/stock/purchase-orders');

  await step('30-stock-purchase-order-create', async () => {
    await open(page, '/admin/stock/purchase-orders');
    await page.getByRole('button', { name: /New Purchase Order/i }).click();
    await page.locator('.ant-drawer-content, [role="dialog"]').first().waitFor({ timeout: 15_000 });
    await settle(page, 800);
    await shot(page, '30-stock-purchase-order-create', { viewport: true });
    await page.keyboard.press('Escape');
  });

  await step('31-stock-purchase-order-receive', async () => {
    await open(page, '/admin/stock/purchase-orders');
    await page.getByRole('button', { name: /Receive/i }).first().click();
    await page.locator('.ant-drawer-content, [role="dialog"]').first().waitFor({ timeout: 15_000 });
    await settle(page, 800);
    await shot(page, '31-stock-purchase-order-receive', { viewport: true });
    await page.keyboard.press('Escape');
  });

  await pageShot(page, '32-stock-procurement-requests', '/admin/stock/procurement-requests');

  await browser.close();
  writeManifest('manifest-01-operation-stock.json');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
