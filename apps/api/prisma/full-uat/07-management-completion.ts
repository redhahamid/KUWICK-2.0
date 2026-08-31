/**
 * SECTION 7 — THE MANAGEMENT COMPLETION SURFACES.
 *
 * Everything built after the last visual pack, which is where the programme's
 * acceptance question actually gets answered: can a clinic run these workflows
 * without going back to a workbook?
 *
 *   - Finance ▸ Panel money      — what we billed and never claimed, what the
 *                                  admin fee costs, where the fee rule and the
 *                                  banked money disagree (D-113)
 *   - Finance ▸ Supplier payables — the question Kuwick could not answer at all
 *   - Panel ▸ Import claims       — G-12, the cutover blocker
 *   - Panel ▸ Configuration       — the four-state fee treatment (D-112)
 *   - Panel ▸ Work queue          — rejection categories, the re-claim
 *                                   countdown, charge-to-patient
 *   - Stock ▸ New item requests   — and the duplicate guard
 *   - Stock ▸ Near expiry         — the at-risk ceiling (D-114)
 *
 * EVERY FIGURE IS COMPUTED BY THE API from the synthetic seed. Where a workflow
 * needs an action performed, the script performs it in the browser. The import
 * fixtures are synthetic files committed beside this script, so the capture is
 * reproducible and no real clinic data is ever involved.
 *
 * RUN THE SEED FIRST. This script COMMITS an import, and the importer is
 * idempotent by design — so on a second run against the same tenant the commit
 * button is correctly absent and shot 106 reports itself as not captured. That
 * is the safety rule working, not a broken script.
 */
import { join } from 'node:path';
import { ensureOut, launch, open, pageShot, settle, shot, step, wideShot, writeManifest } from './harness';

const FIXTURES = join(__dirname, 'fixtures');

/** The tab strips on the new screens are button groups, not routes. */
async function tab(page: import('playwright-core').Page, route: string, label: RegExp) {
  await open(page, route);
  await page.getByRole('button', { name: label }).click();
  await settle(page);
}

async function main() {
  ensureOut();
  const { browser, page } = await launch();

  // =========================================================================
  // FINANCE ▸ PANEL MONEY (D-113)
  // =========================================================================

  // THE NUMBER THIS SCREEN EXISTS FOR: money billed to a panel that nobody
  // ever claimed. It appears in no claim listing anywhere, which is exactly
  // why the clinic reconciles its billing export against the workbook by hand
  // every month.
  await step('90-finance-panel-money-never-claimed', async () => {
    await open(page, '/admin/finance/panel-money');
    await wideShot(page, '90-finance-panel-money-never-claimed', 2200);
  });

  await step('91-finance-panel-money-by-panel', async () => {
    await tab(page, '/admin/finance/panel-money', /^By panel$/);
    await wideShot(page, '91-finance-panel-money-by-panel', 2200);
  });

  // THE FORENSIC PASS, RUNNING BY ITSELF. The owner asked for the workbook's
  // two full-amount payments to be investigated rather than averaged away;
  // this compares every settled claim against what its own fee rule says
  // should have arrived, every time the screen is opened.
  await step('92-finance-panel-money-fee-exceptions', async () => {
    await tab(page, '/admin/finance/panel-money', /Fee exceptions/);
    await wideShot(page, '92-finance-panel-money-fee-exceptions', 2200);
  });

  await step('93-finance-panel-money-receipts', async () => {
    await tab(page, '/admin/finance/panel-money', /Receipts/);
    await wideShot(page, '93-finance-panel-money-receipts', 2200);
  });

  // =========================================================================
  // FINANCE ▸ SUPPLIER PAYABLES
  // =========================================================================

  await step('94-finance-payables-by-supplier', async () => {
    await open(page, '/admin/finance/payables');
    await wideShot(page, '94-finance-payables-by-supplier', 2200);
  });

  await step('95-finance-payables-invoices', async () => {
    await tab(page, '/admin/finance/payables', /^Invoices$/);
    await wideShot(page, '95-finance-payables-invoices', 2400);
  });

  await step('96-finance-payables-payments-made', async () => {
    await tab(page, '/admin/finance/payables', /Payments made/);
    await wideShot(page, '96-finance-payables-payments-made', 2200);
  });

  // A PAYMENT MUST SAY WHICH INVOICES IT SETTLED, and the allocations must
  // equal it exactly — the same rule as a panel remittance, and the reason
  // what-has-been-paid can never drift from the bank.
  await step('97-finance-payables-pay-modal', async () => {
    await open(page, '/admin/finance/payables');
    await page.getByRole('button', { name: /^Pay$/ }).first().click();
    await page.getByRole('dialog').first().waitFor({ timeout: 15_000 });
    await settle(page, 600);
    await shot(page, '97-finance-payables-pay-modal', { viewport: true });
    await page.keyboard.press('Escape');
  });

  // NO TERM MEANS NO DUE DATE. Kuwick will not assume thirty days, and the
  // supplier with nothing recorded is named on the screen rather than filed
  // under "not due yet".
  await step('98-finance-payables-edit-terms-modal', async () => {
    await open(page, '/admin/finance/payables');
    await page.getByRole('button', { name: /Edit terms/ }).last().click();
    await page.getByRole('dialog').first().waitFor({ timeout: 15_000 });
    await settle(page, 600);
    await shot(page, '98-finance-payables-edit-terms-modal', { viewport: true });
    await page.keyboard.press('Escape');
  });

  // =========================================================================
  // PANEL ▸ CONFIGURATION (D-112)
  // =========================================================================

  // THE FOUR-STATE FEE TREATMENT, effective-dated. One seeded panel is
  // deliberately UNCONFIGURED, so the screen can be seen saying that its fee
  // is applied in neither direction rather than guessing.
  await step('99-panel-configuration-fee-treatment', async () => {
    await open(page, '/admin/panel/configuration');
    await wideShot(page, '99-panel-configuration-fee-treatment', 2600);
  });

  // =========================================================================
  // PANEL ▸ WORK QUEUE — the rejection workflow (G-4, G-5, G-6)
  // =========================================================================

  await step('100-panel-work-queue-rejections', async () => {
    await open(page, '/admin/panel');
    await page.getByRole('button', { name: /Work queue/i }).click();
    await settle(page);
    await wideShot(page, '100-panel-work-queue-rejections', 2600);
  });

  // CHARGING A REJECTION TO THE PATIENT (G-5) — one of the four routes out of
  // a rejection in the clinic's own excess register, and explicitly NOT a
  // write-off: the money is still coming, from somebody else.
  await step('101-panel-charge-to-patient-modal', async () => {
    await open(page, '/admin/panel');
    await page.getByRole('button', { name: /Work queue/i }).click();
    await settle(page);
    await page.getByRole('button', { name: /Charge patient/i }).first().click();
    await page.getByRole('dialog').first().waitFor({ timeout: 15_000 });
    await settle(page, 600);
    await shot(page, '101-panel-charge-to-patient-modal', { viewport: true });
    await page.keyboard.press('Escape');
  });

  await step('102-panel-reconciliation-rejection-rate', async () => {
    await open(page, '/admin/panel');
    await page.getByRole('button', { name: /Reconciliation/i }).click();
    await settle(page);
    await wideShot(page, '102-panel-reconciliation-rejection-rate', 2200);
  });

  // =========================================================================
  // PANEL ▸ IMPORT CLAIMS (G-12) — the cutover blocker, end to end
  // =========================================================================

  await step('103-panel-import-empty', async () => {
    await open(page, '/admin/panel/import');
    await wideShot(page, '103-panel-import-empty', 2000);
  });

  // A FILE WITH PROBLEMS IMPORTS NOTHING, and reports every problem at once so
  // the spreadsheet is fixed in one pass. Two deliberate defects in the
  // fixture: a date that means different days in different countries, and a
  // claim marked paid with no money against it.
  await step('104-panel-import-problems', async () => {
    await open(page, '/admin/panel/import');
    await page.locator('.ant-select').filter({ hasText: 'Which panel' }).click();
    await page.locator('.ant-select-item-option').filter({ hasText: 'MediCover' }).first().click();
    await settle(page, 300);
    await page.locator('.ant-select').filter({ hasText: 'Which branch' }).click();
    await page.locator('.ant-select-item-option').filter({ hasText: 'Contoh Central' }).first().click();
    await settle(page, 300);
    await page.locator('input[type="file"]').setInputFiles(join(FIXTURES, 'claims-with-problems.csv'));
    await settle(page, 400);
    await page.getByRole('button', { name: /Check the file/ }).click();
    await settle(page, 900);
    await wideShot(page, '104-panel-import-problems', 2000);
  });

  // THE CORRECTED FILE, DRY RUN. The totals are what the clinic compares
  // against the workbook's own TOTAL row — the only check that proves the
  // import is right, and one that cannot be made afterwards.
  await step('105-panel-import-dry-run', async () => {
    await open(page, '/admin/panel/import');
    await page.locator('.ant-select').filter({ hasText: 'Which panel' }).click();
    await page.locator('.ant-select-item-option').filter({ hasText: 'MediCover' }).first().click();
    await settle(page, 300);
    await page.locator('.ant-select').filter({ hasText: 'Which branch' }).click();
    await page.locator('.ant-select-item-option').filter({ hasText: 'Contoh Central' }).first().click();
    await settle(page, 300);
    await page.locator('input[type="file"]').setInputFiles(join(FIXTURES, 'claims-corrected.csv'));
    await settle(page, 400);
    await page.getByRole('button', { name: /Check the file/ }).click();
    await settle(page, 900);
    await wideShot(page, '105-panel-import-dry-run', 2000);
  });

  await step('106-panel-import-committed', async () => {
    await page.getByRole('button', { name: /The totals match/ }).click();
    await settle(page, 1200);
    await wideShot(page, '106-panel-import-committed', 2000);
  });

  // AND THE MONEY ARRIVES WHERE THE DRY RUN SAID IT WOULD. Same
  // computeClaimBalance, so the panel dashboard must now agree with the
  // figures on the import screen.
  await step('107-panel-money-after-import', async () => {
    await open(page, '/admin/finance/panel-money');
    await wideShot(page, '107-panel-money-after-import', 2200);
  });

  // =========================================================================
  // STOCK — the operating model behind the workbooks
  // =========================================================================

  // ASKING FOR SOMETHING THE CATALOGUE DOES NOT HAVE, with the duplicate check
  // that stops one medicine becoming two stock levels and a count that never
  // reconciles.
  await step('108-stock-new-item-requests', async () => {
    await open(page, '/admin/stock/new-item-requests');
    await wideShot(page, '108-stock-new-item-requests', 2200);
  });

  await step('109-stock-new-item-duplicate-guard', async () => {
    await open(page, '/admin/stock/new-item-requests');
    const flagged = page.locator('.ant-table-tbody tr.ant-table-row').filter({ hasText: /Amoxicillin/i });
    await flagged.first().getByRole('button', { name: /Approve/i }).click();
    await page.getByRole('dialog').first().waitFor({ timeout: 15_000 });
    await settle(page, 600);
    await shot(page, '109-stock-new-item-duplicate-guard', { viewport: true });
    await page.keyboard.press('Escape');
  });

  // WHAT IS ABOUT TO EXPIRE — and how much of it can actually still be on the
  // shelf. `Received` is what arrived; `At risk` is bounded by what the clinic
  // holds of the item, because nothing attributes a dispense to a batch
  // (D-114).
  await pageShot(page, '110-stock-near-expiry-at-risk', '/admin/stock/near-expiry');

  // SELLING VALUE AT COUNT TIME, beside cost and never added to it.
  await step('111-stock-take-selling-value', async () => {
    await open(page, '/admin/stock/stock-take');
    const row = page.locator('.ant-table-tbody tr.ant-table-row').first();
    if ((await row.count()) > 0) await row.click();
    await settle(page, 700);
    await wideShot(page, '111-stock-take-selling-value', 2200);
  });

  await browser.close();
  writeManifest('07-management-completion.json');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
