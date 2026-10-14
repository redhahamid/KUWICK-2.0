import { expect, test } from '@playwright/test';
import { loginAdmin } from './support/admin';

/**
 * OWN COLUMNS AND CARRY FORWARD, run by hand against the dev servers
 * (`playwright.uat.config.ts`), never as part of the gate.
 *
 *   UAT_RUN_ID=<an unapproved run> UAT_STAFF_NAME="<a person on it>" \
 *   UAT_PERIOD=<the run's month, YYYY-MM> UAT_BRANCH="<the run's branch, as the picker names it>" \
 *   CHROME_PATH=/opt/pw-browsers/chromium \
 *   npx playwright test --config playwright.uat.config.ts e2e/own-columns.uat.ts
 *
 * It switches "Own column" and "Carry forward" on for the director's fee,
 * types an amount straight into the grid and saves it once, sees the foot,
 * the drawer and the sticky name column agree, starts the next month at the
 * same branch and sees the line carried and counted on Review — then removes
 * the carried line, discards the new month, clears the cell and switches the
 * item back, so the world is left as it was found (bar the audit rows).
 */
const RUN = process.env.UAT_RUN_ID ?? '';
const NAME = process.env.UAT_STAFF_NAME ?? '';
const PERIOD = process.env.UAT_PERIOD ?? '';
const BRANCH = process.env.UAT_BRANCH ?? '';
const SHOTS = process.env.UAT_SHOTS ?? 'test-results/own-columns';

test.skip(!RUN || !NAME || !PERIOD || !BRANCH, 'Set UAT_RUN_ID, UAT_STAFF_NAME, UAT_PERIOD and UAT_BRANCH to run this walkthrough.');

const nextMonth = (period: string) => {
  const [year, month] = period.split('-').map(Number);
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
};
const monthLabel = (period: string) =>
  new Date(`${period}-01T00:00:00.000Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

test('an item with its own column is typed into the grid, saved once, and carried into the next month', async ({ page }) => {
  await loginAdmin(page);

  // 1. Settings: two layout switches, no date and no reason asked.
  await page.goto('/admin/hr/settings/payroll-items');
  // The switches are in the item's panel, opened from its row (UAT, 10 October 2026).
  await page.getByRole('button', { name: "Director's fee", exact: true }).click();
  const own = page.getByRole('switch', { name: "Own column for Director's fee" });
  await expect(own).toBeVisible();
  const ownWasOn = (await own.getAttribute('aria-checked')) === 'true';
  if (!ownWasOn) {
    await own.click();
    await expect(page.getByText("Director's fee now has its own column on the payroll grid.")).toBeVisible();
  }
  const carry = page.getByRole('switch', { name: "Repeat next month automatically for Director's fee" });
  const carryWasOn = (await carry.getAttribute('aria-checked')) === 'true';
  if (!carryWasOn) {
    await carry.click();
    await expect(page.getByText("Director's fee will start each month with last month’s amount for each person.")).toBeVisible();
  }
  await expect(page.getByRole('dialog', { name: /take effect/i })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/01-settings-switches.png` });

  // 2. The grid: the column is folded until somebody has an amount, then typed into and saved once.
  await page.goto(`/admin/hr/payroll/${RUN}?step=prepare`);
  await expect(page.getByRole('table')).toBeVisible({ timeout: 60_000 });
  const folded = page.getByText(/column hidden \(.*Director's fee.*\): nobody in this list has an amount/);
  if (await folded.isVisible()) {
    await page.screenshot({ path: `${SHOTS}/02-column-folded.png` });
    await page.getByRole('button', { name: 'Show all columns' }).click();
  }
  const cell = page.getByRole('textbox', { name: `Director's fee for ${NAME}` });
  await expect(cell).toBeVisible();
  await cell.fill('2000');
  await expect(page.getByText('1 change not saved.')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/03-typed-not-saved.png` });
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('1 change saved and the month worked out again.')).toBeVisible({ timeout: 90_000 });
  await expect(cell).toHaveValue('2000.00', { timeout: 30_000 });
  await expect(page.getByText(/not saved/)).toHaveCount(0);
  await expect(page.locator('tfoot')).toContainText('2,000.00');
  await page.screenshot({ path: `${SHOTS}/04-saved-foot-follows.png` });

  // Sideways, the name column stays put.
  await page.locator('.hr-scrollX').evaluate((element) => {
    element.scrollLeft = 900;
  });
  await expect(page.getByRole('link', { name: new RegExp(NAME) }).first()).toBeInViewport();
  await page.screenshot({ path: `${SHOTS}/05-scrolled-name-sticky.png` });
  await page.locator('.hr-scrollX').evaluate((element) => {
    element.scrollLeft = 0;
  });

  // 3. The drawer agrees: the line sits under its own column, out of Other income.
  await page.getByRole('button', { name: `Other income for ${NAME}: open the month's items` }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('region', { name: 'In their own columns' })).toContainText("Director's fee");
  await expect(drawer.getByRole('region', { name: 'Counted in Other income' })).not.toContainText("Director's fee");
  await page.screenshot({ path: `${SHOTS}/06-drawer-own-column.png` });
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();

  // 4. Start the next month at the same branch: the line is carried, marked, and counted on Review.
  const NEXT = nextMonth(PERIOD);
  await page.goto(`/admin/hr/payroll?period=${NEXT}`);
  await page.getByRole('combobox', { name: 'Branch' }).click();
  // The picker is a virtual list: a branch far down it is not drawn until
  // the list is scrolled, so scroll until it is.
  const option = page.getByTitle(BRANCH);
  for (let step = 0; step < 20 && !(await option.isVisible()); step += 1) {
    await page.locator('.ant-select-dropdown .rc-virtual-list-holder').evaluate((element, offset) => {
      element.scrollTop = offset;
    }, (step + 1) * 120);
    await page.waitForTimeout(100);
  }
  await option.click();
  await page.getByRole('button', { name: `Start ${monthLabel(NEXT)} payroll` }).click();
  await expect(page.getByText(new RegExp(`1 line carried from ${monthLabel(PERIOD)} for 1 person`))).toBeVisible({ timeout: 60_000 });
  await expect(page).toHaveURL(/step=prepare/, { timeout: 120_000 });
  const carriedCell = page.getByRole('textbox', { name: `Director's fee for ${NAME}` });
  await expect(carriedCell).toHaveValue('2000.00', { timeout: 120_000 });
  await expect(page.getByText('Carried', { exact: true })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/07-next-month-carried.png` });
  const newRun = /payroll\/([0-9a-f-]{36})/.exec(page.url())![1];
  await page.goto(`/admin/hr/payroll/${newRun}?step=review`);
  await expect(page.getByTestId('carried-unchecked')).toContainText(`1 line carried from ${monthLabel(PERIOD)} has not been edited or cleared.`);
  await page.screenshot({ path: `${SHOTS}/08-review-carried-count.png` });

  // 5. Leave the world as it was found: the carried line removed, the month discarded, the cell cleared, the switches back.
  await page.goto(`/admin/hr/payroll/${newRun}?step=prepare`);
  await page.getByRole('button', { name: `Other income for ${NAME}: open the month's items` }).click();
  await drawer.getByRole('region', { name: 'In their own columns' }).getByRole('button', { name: 'Remove' }).first().click();
  await expect(page.getByText("Director's fee removed.")).toBeVisible();
  await expect(drawer.getByText('Worked out again. The register and the payslip lines are up to date.')).toBeVisible({ timeout: 90_000 });
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await page.getByRole('button', { name: 'Discard draft' }).click();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page).not.toHaveURL(new RegExp(newRun), { timeout: 60_000 });

  await page.goto(`/admin/hr/payroll/${RUN}?step=prepare`);
  const cellAgain = page.getByRole('textbox', { name: `Director's fee for ${NAME}` });
  await expect(cellAgain).toHaveValue('2000.00', { timeout: 60_000 });
  await cellAgain.fill('');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('1 change saved and the month worked out again.')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/1 column hidden \(Director's fee\): nobody in this list has an amount in it\./)).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: `${SHOTS}/09-cleared-folded-again.png` });

  await page.goto('/admin/hr/settings/payroll-items');
  await page.getByRole('button', { name: "Director's fee", exact: true }).click();
  if (!ownWasOn) {
    await page.getByRole('switch', { name: "Own column for Director's fee" }).click();
    await expect(page.getByText("Director's fee is back in Other income on the payroll grid.")).toBeVisible();
  }
  if (!carryWasOn) {
    await page.getByRole('switch', { name: "Repeat next month automatically for Director's fee" }).click();
    await expect(page.getByText("Director's fee will start each month empty.")).toBeVisible();
  }
});
