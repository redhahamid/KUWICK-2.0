import { expect, test } from '@playwright/test';
import { ADMIN_ACCOUNTS, collectAdminConsoleErrors, gotoAdmin, loginAdmin, statValue } from './support/admin';

/**
 * SCENARIO 2 (a panel visit through to money) and SCENARIO 3 (a rejection,
 * re-claimed).
 *
 * The workspace replaces a Google Sheet, and the two things the sheet got
 * wrong are the two things asserted hardest here: that "sent" and "paid" are
 * different facts, and that Kuwick cannot submit to a portal it has no
 * interface to. A screen that blurs either one produces a clinic which
 * believes it has been paid.
 */
test.describe('Panel', () => {
  test('sent is not paid, and the reconciliation adds up', async ({ page }) => {
    const errors = collectAdminConsoleErrors(page);
    await loginAdmin(page, ADMIN_ACCOUNTS.panel);
    await gotoAdmin(page, '/admin/panel');

    await expect(page.getByRole('heading', { name: 'Panel Claims' })).toBeVisible();

    // The three questions the module exists to answer, in the subtitle.
    await expect(page.getByText(/What has not been submitted, what was rejected, and what money is still outstanding/i)).toBeVisible();

    // KUWICK DOES NOT SUBMIT. Saying otherwise would have a clinic believe
    // claims went out that are sitting on somebody's desk.
    await expect(page.getByText(/Kuwick does not submit to any panel portal/i)).toBeVisible();

    // The money must reconcile arithmetically, and the screen must say whether
    // it does rather than leaving the reader to add it up.
    await page.getByRole('button', { name: /Reconciliation/i }).click();
    await expect(page.locator('.ant-spin-spinning')).toHaveCount(0, { timeout: 30_000 });

    const cents = (money: string) => Math.round(Number(money.replace(/[^0-9.]/g, '')) * 100);
    const expected = cents(await statValue(page, 'EXPECTED RECEIVABLE').innerText());
    const received = cents(await statValue(page, 'RECEIVED').innerText());
    const outstanding = cents(await statValue(page, 'OUTSTANDING').innerText());
    const rejected = cents(await statValue(page, 'REJECTED').innerText());
    const writtenOff = cents(await statValue(page, 'WRITTEN OFF').innerText());
    const overRecovered = cents(await statValue(page, 'OVER-RECOVERED').innerText());

    // Every ringgit claimed is in exactly one of these four states — PLUS the
    // money that arrived beyond what the fee rule expected. That last term is
    // not slack in the identity: the four states partition the EXPECTATION,
    // and a panel that does not deduct its own admin fee pays the whole claim,
    // putting money outside it. The seeded clinic contains exactly one such
    // claim, which is why this assertion caught the missing term.
    expect(received + outstanding + rejected + writtenOff).toBe(expected + overRecovered);
    await expect(statValue(page, 'RECONCILES')).toHaveText('Yes');

    expect(errors).toEqual([]);
  });

  test('a claim is checked for completeness before somebody opens the portal', async ({ page }) => {
    const errors = collectAdminConsoleErrors(page);
    await loginAdmin(page, ADMIN_ACCOUNTS.panel);
    await gotoAdmin(page, '/admin/panel');

    await page.getByRole('button', { name: /To submit/i }).click();
    await expect(page.locator('.ant-spin-spinning')).toHaveCount(0, { timeout: 30_000 });

    // The point of the checklist: find out what is missing BEFORE the portal
    // rejects it, not four weeks later.
    await expect(page.getByText(/Fix them before opening the portal rather than after being rejected/i)).toBeVisible();

    // One complete claim and one that is missing what its panel requires.
    await expect(page.getByRole('row', { name: /Complete/ }).first()).toBeVisible();
    await expect(page.getByRole('row', { name: /requires itemisation/ }).first()).toBeVisible();

    // "Mark submitted" records that a PERSON keyed it in. It is not a
    // transmission, and the button next to it opens the portal for them.
    await expect(page.getByRole('link', { name: /Open portal/ }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Mark submitted/ }).first()).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('a rejection is work in a queue, and each panel carries its own rules', async ({ page }) => {
    const errors = collectAdminConsoleErrors(page);
    await loginAdmin(page, ADMIN_ACCOUNTS.panel);
    await gotoAdmin(page, '/admin/panel');

    await page.getByRole('button', { name: /Work queue/i }).click();
    await expect(page.locator('.ant-spin-spinning')).toHaveCount(0, { timeout: 30_000 });
    // A rejected claim that nobody owns is money written off by accident.
    await expect(page.locator('.ant-table-tbody tr.ant-table-row').first()).toBeVisible();

    // --- Each panel's own rules, because they genuinely differ ------------
    await gotoAdmin(page, '/admin/panel/configuration');
    await expect(page.getByRole('heading', { name: 'Panel Configuration' })).toBeVisible();

    // The three panels model three different real behaviours: one corrects a
    // rejected claim in place, two require a brand new claim number.
    await expect(page.getByRole('row', { name: /Correct in place/ }).first()).toBeVisible();
    await expect(page.getByRole('row', { name: /Re-claim under a new number/ }).first()).toBeVisible();

    // A panel with no portal link is a panel whose staff get no checklist —
    // said out loud rather than left as an empty column.
    await expect(page.getByText(/no portal link or submission method recorded/i)).toBeVisible();

    expect(errors).toEqual([]);
  });
});
