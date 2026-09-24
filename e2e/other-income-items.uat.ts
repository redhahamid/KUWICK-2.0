import { expect, test } from '@playwright/test';
import { loginAdmin } from './support/admin';

/**
 * THE OTHER INCOME CELL IS THE MONTH'S ITEMS, run by hand against the dev
 * servers (`playwright.uat.config.ts`), never as part of the gate.
 *
 *   UAT_RUN_ID=<an unapproved run> UAT_STAFF_NAME="<a person on it>" \
 *   CHROME_PATH=/opt/pw-browsers/chromium \
 *   npx playwright test --config playwright.uat.config.ts e2e/other-income-items.uat.ts
 *
 * It adds a director's fee and last month's locum fee through the cell, sees
 * the subtotal, the cell and the person's earnings follow, then removes both
 * lines so the run is left as it was found.
 */
const RUN = process.env.UAT_RUN_ID ?? '';
const NAME = process.env.UAT_STAFF_NAME ?? '';
const SHOTS = process.env.UAT_SHOTS ?? 'test-results/other-income-items';

test.skip(!RUN || !NAME, 'Set UAT_RUN_ID and UAT_STAFF_NAME to run this walkthrough.');

test('the cell opens the items, two lines become two lines everywhere, and removal restores the month', async ({ page }) => {
  await loginAdmin(page);
  await page.goto(`/admin/hr/payroll/${RUN}?step=prepare`);
  const cell = page.getByRole('button', { name: `Other income for ${NAME}: open the month's items` });
  await expect(cell).toBeVisible();
  await expect(cell).toHaveText(/0\.00/);
  await cell.click();

  const drawer = page.getByRole('dialog');
  await expect(drawer.getByText('Counted in Other income')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/01-drawer-empty.png` });

  const add = async (item: string, amount: string, reason: string, earnedIn?: string) => {
    await drawer.getByRole('button', { name: 'Add a line' }).click();
    await page.getByRole('combobox', { name: 'Item' }).click();
    await page.getByTitle(item).click();
    await page.getByRole('spinbutton', { name: 'Amount' }).fill(amount);
    if (earnedIn) {
      const month = page.getByRole('textbox', { name: 'Earned in' });
      await month.fill(earnedIn);
      await month.press('Enter');
    }
    await page.getByRole('textbox', { name: 'Reason' }).fill(reason);
    await page.getByRole('button', { name: 'Add line' }).click();
    await expect(drawer.getByText('Worked out again. The register and the payslip lines are up to date.')).toBeVisible({ timeout: 90_000 });
  };

  await add("Director's fee (DIRECTOR_FEE)", '2000', 'Board meeting, January');
  await add('Locum fee (LOCUM_FEE)', '900', 'Three December sessions', '2025-12');

  await expect(drawer.getByTestId('subtotal-OTHER_INCOME')).toHaveText(/2,900\.00/);
  await expect(drawer.getByText('Earned Dec 2025')).toBeVisible();
  await expect(drawer.getByText(/has not been worked out since/)).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/02-drawer-two-lines.png` });

  await page.keyboard.press('Escape');
  await expect(cell).toHaveText(/2,900\.00/, { timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}/03-grid-cell-follows.png` });

  // The person's own payroll page itemises the two lines under their own names.
  await page.getByRole('link', { name: new RegExp(NAME) }).first().click();
  await expect(page.getByText("Director's fee").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Locum fee').first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/04-employee-lines.png`, fullPage: true });

  // Leave the run as it was found: remove both lines through the same drawer.
  await page.getByRole('button', { name: 'This month’s items' }).click();
  for (const item of ["Director's fee", 'Locum fee']) {
    await drawer.getByRole('button', { name: 'Remove' }).first().click();
    await expect(page.getByText(`${item} removed.`)).toBeVisible();
    await expect(drawer.getByText('Worked out again. The register and the payslip lines are up to date.')).toBeVisible({ timeout: 90_000 });
  }
  await expect(drawer.getByTestId('subtotal-OTHER_INCOME')).toHaveText(/0\.00/);
});
