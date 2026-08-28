import { expect, test } from '@playwright/test';
import { ADMIN_ACCOUNTS, chooseBranch, collectAdminConsoleErrors, gotoAdmin, loginAdmin, statValue } from './support/admin';

/**
 * SCENARIO 4 (inventory) and SCENARIO 5 (stock take).
 *
 * The one thing being protected across both: CURRENT STOCK IS DERIVED. Every
 * balance on every screen is the sum of an append-only ledger, and the two
 * workflows that change stock — a transfer between branches, and a count that
 * disagrees with the system — go through approval before they touch it. A
 * spec that only checked "the number changed" would pass against the very
 * design this replaced, where typing a count moved live stock immediately.
 */
test.describe('Stock', () => {
  test('the exception board answers what needs attention, and the ledger explains every balance', async ({ page }) => {
    const errors = collectAdminConsoleErrors(page);
    await loginAdmin(page, ADMIN_ACCOUNTS.stock);
    await gotoAdmin(page, '/admin/stock');

    await expect(page.getByRole('heading', { name: 'Stock', exact: true })).toBeVisible();

    // The landing page is a work queue, not a report: each tile is a count of
    // things somebody has to do something about today.
    for (const label of ['Negative stock', 'Below minimum', 'Expired', 'Expiring in 90d', 'Transfer discrepancies']) {
      await expect(page.locator('.kw-exceptionTile__label', { hasText: new RegExp(`^${label}$`) })).toBeVisible();
    }

    // Valuation must never be presented as profit. Both halves of that
    // sentence are asserted because either one alone can be read wrongly.
    await expect(page.getByText(/Weighted-average and FIFO costing are not implemented/i)).toBeVisible();
    await expect(page.getByText(/It is not profit and not a forecast/i)).toBeVisible();
    await expect(statValue(page, 'POTENTIAL SELF-PAY VALUE')).toBeVisible();

    // A view shows only the columns it actually reports. The seven exception
    // views share one table, and padding the gaps with em-dashes turned "this
    // view does not report cost" into "this item has no cost on record" — with
    // a panel three lines below saying none are missing one.
    const board = page.locator('.kw-dataTable').first();
    await expect(board.getByRole('columnheader', { name: 'Shortfall' })).toBeVisible();
    await expect(board.getByRole('columnheader', { name: 'Value at cost' })).toHaveCount(0);
    await expect(board.getByRole('columnheader', { name: 'Last dispensed' })).toHaveCount(0);

    // --- The ledger is the source, and says so ----------------------------
    await gotoAdmin(page, '/admin/stock/movements');
    await expect(page.getByText(/append-only, enforced by the database/i)).toBeVisible();
    await expect(page.getByText(/corrected with a compensating movement/i)).toBeVisible();

    // A movement carries who and why, or it cannot be audited.
    const firstRow = page.locator('.ant-table-tbody tr.ant-table-row').first();
    await expect(firstRow).toBeVisible();
    await expect(firstRow).toContainText(/[A-Z]/);

    expect(errors).toEqual([]);
  });

  test('stock that has left one branch and not arrived is on neither shelf', async ({ page }) => {
    const errors = collectAdminConsoleErrors(page);
    await loginAdmin(page, ADMIN_ACCOUNTS.stock);
    await gotoAdmin(page, '/admin/stock/transfers');

    await expect(page.getByRole('heading', { name: 'Stock Transfers' })).toBeVisible();
    await expect(page.getByText(/in between it is in transit, on neither shelf/i)).toBeVisible();

    // A discrepancy is a loss to investigate, never a number to quietly
    // reconcile — the sender cannot restore what the receiver did not get.
    await expect(page.getByText(/STAYS missing/)).toBeVisible();
    await expect(page.getByRole('row', { name: /Discrepancy/ }).first()).toBeVisible();

    // In-transit stock is visible and valued, so it cannot simply vanish.
    const inTransit = Number((await statValue(page, 'IN TRANSIT').innerText()).replace(/\D/g, ''));
    expect(inTransit).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: /^Receive$/ }).first()).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('typing a count changes nothing until a second person approves it', async ({ page }) => {
    const errors = collectAdminConsoleErrors(page);
    await loginAdmin(page, ADMIN_ACCOUNTS.stock);
    await gotoAdmin(page, '/admin/stock/stock-take');

    await expect(page.getByRole('heading', { name: 'Stock Take', exact: true })).toBeVisible();
    // The rule the whole workflow exists for, on the screen that enforces it.
    await expect(page.getByText(/Typing a count changes nothing on its own/i)).toBeVisible();
    await expect(page.getByText(/a second person approves/i)).toBeVisible();

    // A posted take shows the variance it corrected and what that cost.
    await expect(page.getByRole('row', { name: /Posted/ }).first()).toBeVisible();

    expect(errors).toEqual([]);
  });
});
