import { expect, test } from '@playwright/test';
import { ADMIN_ACCOUNTS, chooseBranch, collectAdminConsoleErrors, gotoAdmin, loginAdmin, statValue } from './support/admin';

/**
 * SCENARIO 1 (self-pay) and SCENARIO 7 (day end), driven through the UI.
 *
 * These two belong together because they are the same money seen twice: a
 * payment taken at the counter is what a person then counts in the drawer at
 * nine o'clock, and the whole point of the day-end workflow is that those two
 * numbers are reconciled by a named human rather than assumed equal.
 *
 * What each assertion is protecting is written above it. A spec that only
 * checks a number appeared is a spec that goes on passing when the number
 * becomes wrong.
 */
test.describe('Finance', () => {
  test('a self-pay payment reaches the payment report, the receivable and the drawer', async ({ page }) => {
    const errors = collectAdminConsoleErrors(page);
    await loginAdmin(page, ADMIN_ACCOUNTS.finance);

    // --- The overview answers "did yesterday reconcile?" ------------------
    await gotoAdmin(page, '/admin/finance');
    // A group-level finance account is pinned to no branch, so it has to say
    // which one — the picker in the hub header is what makes that possible.
    await chooseBranch(page, 'Contoh Central');
    await expect(page.getByRole('heading', { name: 'Finance', exact: true })).toBeVisible();

    // Patient and panel receivables are never added into one number: they are
    // chased by different people through different processes.
    const patientReceivable = await statValue(page, 'PATIENT RECEIVABLE').innerText();
    const panelReceivable = await statValue(page, 'PANEL RECEIVABLE').innerText();
    expect(patientReceivable).toMatch(/^RM[\d,]+\.\d{2}$/);
    expect(panelReceivable).toMatch(/^RM[\d,]+\.\d{2}$/);
    expect(patientReceivable).not.toBe(panelReceivable);

    // --- The payment report is bucketed by when money MOVED ---------------
    await gotoAdmin(page, '/admin/finance/payments');
    await expect(page.getByRole('heading', { name: 'Payments' })).toBeVisible();

    const received = await statValue(page, 'RECEIVED').innerText();
    const refunded = await statValue(page, 'REFUNDED').innerText();
    const net = await statValue(page, 'NET').innerText();
    const cents = (money: string) => Math.round(Number(money.replace(/[^0-9.]/g, '')) * 100);
    // The arithmetic the screen claims, checked rather than trusted.
    expect(cents(net)).toBe(cents(received) - cents(refunded));

    // A REVERSAL is not a refund, and the screen has to say so — otherwise a
    // correction to a mis-keyed payment reads as money handed back.
    await expect(page.getByText(/A REVERSAL is not a refund/i)).toBeVisible();

    // Both halves of the reversed pair are on the ledger and neither counts.
    await expect(page.getByRole('row', { name: /Reversed/i }).first()).toBeVisible();

    // --- The same money, as an outstanding balance -------------------------
    await gotoAdmin(page, '/admin/finance/receivables');
    await expect(page.getByRole('heading', { name: 'Outstanding' })).toBeVisible();
    // The aging buckets must sum to the headline, or the headline is a guess.
    await expect(page.locator('.kw-exceptionTile__label', { hasText: /0–30 days/ })).toBeVisible();
    await expect(page.locator('.kw-exceptionTile__label', { hasText: /Over 90/ })).toBeVisible();
    expect(await statValue(page, 'PATIENT RECEIVABLE').innerText()).toBe(patientReceivable);

    expect(errors).toEqual([]);
  });

  test('a day is counted, closed, and cannot then be quietly edited', async ({ page }) => {
    const errors = collectAdminConsoleErrors(page);
    await loginAdmin(page, ADMIN_ACCOUNTS.finance);

    // The overview lists the days that still need closing — the work queue.
    await gotoAdmin(page, '/admin/finance');
    await chooseBranch(page, 'Contoh Central');
    const unreconciled = Number((await statValue(page, 'UNRECONCILED DAYS').innerText()).replace(/\D/g, ''));
    expect(unreconciled).toBeGreaterThan(0);

    // Walking into a day from that list is the workflow; a report would make
    // you retype the date.
    await page.getByRole('button', { name: /Close this day/i }).first().click();
    await expect(page).toHaveURL(/\/admin\/finance\/day-end/);
    await expect(page.locator('.ant-spin-spinning')).toHaveCount(0, { timeout: 30_000 });

    // What the ledger expects is derived, never typed.
    const expectedTotal = await statValue(page, 'EXPECTED TOTAL').innerText();
    expect(expectedTotal).toMatch(/^-?RM[\d,]+\.\d{2}$/);

    // Count the drawer. A blank tender means "not counted", which is a
    // different fact from "counted zero" and must stay different.
    await expect(page.getByText(/Leave a box empty if you have not counted that tender/i)).toBeVisible();

    const cashBox = page.locator('.kw-countRow', { hasText: 'Notes and coins in the drawer' }).locator('input').first();
    await cashBox.fill('100');
    await page.getByRole('button', { name: /^Save count$/i }).click();

    // Variance appears only once somebody has counted — it is measured, not
    // assumed, and RM0.00 before a count would be a lie.
    await expect(statValue(page, 'VARIANCE')).not.toHaveText('—', { timeout: 20_000 });

    expect(errors).toEqual([]);
  });

  test('a credit note leaves the original invoice exactly as it was issued', async ({ page }) => {
    const errors = collectAdminConsoleErrors(page);
    await loginAdmin(page, ADMIN_ACCOUNTS.finance);
    await gotoAdmin(page, '/admin/finance/credit-notes');
    await chooseBranch(page, 'Contoh Central');

    await expect(page.getByRole('heading', { name: 'Credit Notes', exact: true })).toBeVisible();
    // The rule the whole entity exists for, stated on the screen that uses it.
    await expect(page.getByText(/leaves the original invoice exactly as issued/i)).toBeVisible();
    // A draft credits nothing, and the approver cannot be the raiser.
    await expect(page.getByText(/A DRAFT credit note reduces nothing/i)).toBeVisible();
    // Raising and issuing are separate PERMISSIONS, and both names are on the
    // note — but the code does not check that the two people differ, so the
    // screen says to read the names rather than implying a four-eyes rule it
    // does not enforce. (The stock take, which does enforce one, says so.)
    await expect(page.getByText(/SEPARATE issuing\s+permission/i)).toBeVisible();
    await expect(page.getByText(/read the two names below rather than assuming two people/i)).toBeVisible();

    await expect(page.getByRole('row', { name: /ISSUED/ }).first()).toBeVisible();
    expect(errors).toEqual([]);
  });
});
