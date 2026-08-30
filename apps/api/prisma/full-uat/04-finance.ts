/**
 * SECTION 5 — FINANCE, every screen and every state.
 *
 * The day-end is captured in its three real states — OPEN with expected
 * figures derived, COUNTED with a variance that blocks the close, and CLOSED
 * with the figures frozen — by DRIVING it, not by seeding the end state. The
 * seed leaves today open at Contoh Central with takings in all four tender
 * buckets and a RM40 card refund, so the arithmetic on screen is real.
 *
 * e-Invoice is captured deliberately and prominently: the owner asked that it
 * be impossible to mistake an unfinished implementation for live LHDN
 * submission, and the page exists to say exactly that.
 */
import { ensureOut, launch, open, pageShot, settle, shot, step, writeManifest } from './harness';

async function main() {
  ensureOut();
  const { browser, page } = await launch();

  await pageShot(page, '90-finance-overview', '/admin/finance');

  // --- Sales ------------------------------------------------------------
  await pageShot(page, '91-finance-sales-report', '/admin/finance/sales');

  // The sales report carries the owner's "sales detail" asks as sections:
  // by day, panel vs non-panel, by category, by doctor, by panel company.
  await step('92-finance-sales-breakdowns', async () => {
    await open(page, '/admin/finance/sales');
    await page.locator('text=% of Sales by Doctors').first().scrollIntoViewIfNeeded().catch(() => {});
    await settle(page, 600);
    await shot(page, '92-finance-sales-breakdowns');
  });

  // --- Day-end, driven ---------------------------------------------------
  await step('93-finance-day-end-OPEN', async () => {
    await open(page, '/admin/finance/day-end');
    await shot(page, '93-finance-day-end-OPEN');
  });

  await step('94-finance-day-end-COUNTED-variance', async () => {
    await open(page, '/admin/finance/day-end');
    const expectedOf = async (label: string) => {
      const row = page.locator('.kw-countRow').filter({ has: page.getByLabel(`Counted ${label}`) });
      return Number((await row.locator('.kw-countRow__expected').innerText()).replace(/[^0-9.-]/g, ''));
    };
    const cash = await expectedOf('Cash');
    const card = await expectedOf('Card');
    const qr = await expectedOf('QR');
    const other = await expectedOf('Other');
    console.log(`      expected on screen: cash ${cash} card ${card} qr ${qr} other ${other}`);
    // Counted RM20 SHORT on cash, everything else exact — so the variance, the
    // mandatory reason and the blocked close are all real.
    await page.getByLabel('Counted Cash').fill((cash - 20).toFixed(2));
    await page.getByLabel('Counted Card').fill(card.toFixed(2));
    await page.getByLabel('Counted QR').fill(qr.toFixed(2));
    await page.getByLabel('Counted Other').fill(other.toFixed(2));
    await settle(page, 500);
    await shot(page, '94-finance-day-end-COUNTED-variance');
  });

  await step('95-finance-day-end-variance-reason-required', async () => {
    await page.getByLabel('Reason for the variance').fill(
      'RM20 short — change given from the drawer for a supplier delivery, receipt in the tin. Counted by the counter supervisor.',
    );
    await settle(page, 400);
    await shot(page, '95-finance-day-end-variance-reason-required', { viewport: true });
  });

  await step('96-finance-day-end-CLOSED-locked', async () => {
    await page.getByRole('button', { name: 'Save count' }).click();
    await settle(page);
    await page.getByRole('button', { name: 'Close the day' }).click();
    await settle(page, 1200);
    await shot(page, '96-finance-day-end-CLOSED-locked');
  });

  await step('97-finance-day-end-reopen-modal', async () => {
    await page.getByRole('button', { name: /^Reopen$/ }).click({ timeout: 8_000 });
    await page.getByRole('dialog').first().waitFor({ timeout: 15_000 });
    await settle(page, 600);
    await shot(page, '97-finance-day-end-reopen-modal', { viewport: true });
    await page.keyboard.press('Escape');
  });

  // --- Payments, invoices, receivables ------------------------------------
  await pageShot(page, '98-finance-payment-ledger', '/admin/finance/payments');
  await pageShot(page, '99-finance-invoice-listing', '/admin/finance/invoices');
  await pageShot(page, '100-finance-outstanding-receivables', '/admin/finance/receivables');

  // --- Credit notes -------------------------------------------------------
  await pageShot(page, '101-finance-credit-notes', '/admin/finance/credit-notes');

  // CREATING a credit note has no screen. `useCreateCreditNote` exists and
  // `POST /finance/credit-notes` exists, and nothing in the product calls
  // either — this page filters, lists and APPROVES. So the capture shows the
  // approval, which is the half that is real, and the inventory records the
  // other half as an endpoint with no UI rather than pretending otherwise.
  await step('102-finance-credit-note-approve-DRAFT', async () => {
    await open(page, '/admin/finance/credit-notes');
    await page.getByRole('button', { name: /^Draft$/i }).click({ timeout: 8_000 }).catch(() => {});
    await settle(page, 500);
    await shot(page, '102-finance-credit-note-approve-DRAFT');
  });

  // --- Tax, profitability, inter-company, e-Invoice -----------------------
  await pageShot(page, '103-finance-tax-sst', '/admin/finance/tax');
  await pageShot(page, '104-finance-profitability-drugs', '/admin/finance/profitability');

  await step('105-finance-profitability-procedures-no-cost', async () => {
    await open(page, '/admin/finance/profitability');
    await page.getByText('Services & procedures', { exact: true }).click();
    await settle(page);
    await shot(page, '105-finance-profitability-procedures-no-cost');
  });

  // The five rankings the brief names, on the ranking that matters most.
  await step('106-finance-profitability-lowest-margin', async () => {
    await open(page, '/admin/finance/profitability');
    await page.getByText('Lowest margin', { exact: true }).click();
    await settle(page);
    await shot(page, '106-finance-profitability-lowest-margin');
  });

  await pageShot(page, '107-finance-inter-company', '/admin/finance/inter-company');
  await pageShot(page, '108-finance-e-invoice-NOT-IMPLEMENTED', '/admin/finance/e-invoice');

  await browser.close();
  writeManifest('manifest-04-finance.json');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
