import { expect, test } from '@playwright/test';
import { ADMIN_ROUTES, collectAdminConsoleErrors, gotoAdmin, loginAdmin } from './support/admin';

/**
 * ONE PRODUCT, NOT FIVE PAGES.
 *
 * The brief's first structural requirement is that the five modules feel like
 * one thing. That is not a matter of taste that a person can be trusted to
 * re-check by eye every release — it is a property of the markup, and this is
 * the spec that holds it: every page in the five modules sits in the same
 * frame, reachable from the same rail, and none of them throws.
 *
 * The console-error assertion is the one that has caught the most: a page can
 * look finished and still be logging a failed render on every visit.
 */
test.describe('Admin shell', () => {
  test('every page in the five modules loads, in one frame, with no console errors', async ({ page }) => {
    const errors = collectAdminConsoleErrors(page);
    await loginAdmin(page);

    for (const route of ADMIN_ROUTES) {
      await gotoAdmin(page, route.path);

      // The same frame on all twenty, with the module's own title in it.
      await expect(page.locator('.kw-admin__title')).toHaveText(route.heading);

      // The rail carries all five modules from every page, so a person can
      // cross between them without going back to a hub.
      for (const module of ['Operation', 'Stock', 'Panel', 'HR', 'Finance']) {
        await expect(page.getByRole('tab', { name: module, exact: true })).toBeVisible();
      }

      // Nothing renders an antd error boundary or an empty white page.
      await expect(page.locator('.kw-adminError')).toHaveCount(0);
    }

    expect(errors).toEqual([]);
  });

  test('a dense table carries the whole kit — search, sort, columns, export, totals', async ({ page }) => {
    await loginAdmin(page);
    await gotoAdmin(page, '/admin/finance/receivables');

    const table = page.locator('.kw-dataTable').first();
    await expect(table).toBeVisible();

    // Search narrows the rows a person is looking at, in place.
    const before = await table.locator('.ant-table-tbody tr.ant-table-row').count();
    expect(before).toBeGreaterThan(1);
    await table.getByPlaceholder(/search/i).fill('Chong');
    await expect(table.locator('.ant-table-tbody tr.ant-table-row')).toHaveCount(1);
    await table.getByPlaceholder(/search/i).fill('');
    await expect(table.locator('.ant-table-tbody tr.ant-table-row')).toHaveCount(before);

    // Export and column visibility are on the table itself, not in a menu
    // three clicks away — these tables are read by people reconciling money.
    await expect(table.getByRole('button', { name: /Export/i })).toBeVisible();
    const columnsButton = table.getByTitle('Columns');
    await expect(columnsButton).toBeVisible();
    // It really hides a column, rather than opening an empty menu.
    const headersBefore = await table.locator('.ant-table-thead th').count();
    await columnsButton.click();
    await page.locator('.ant-dropdown .ant-checkbox-wrapper').first().click();
    await expect(table.locator('.ant-table-thead th')).toHaveCount(headersBefore - 1);
    await page.keyboard.press('Escape');

    // A money table without a total is a table somebody adds up by hand.
    await expect(table.locator('.ant-table-summary')).toBeVisible();
  });

  test('the module rail crosses between modules without going back to a hub', async ({ page }) => {
    await loginAdmin(page);
    await gotoAdmin(page, '/admin/finance');

    await page.getByRole('tab', { name: 'Stock', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/stock/);
    await expect(page.locator('.kw-admin__title')).toHaveText('Stock');

    await page.getByRole('tab', { name: 'HR', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/hr/);
    await expect(page.locator('.kw-admin__title')).toHaveText('Workforce');
  });
});

/**
 * RESPONSIVE UAT — the three widths the brief names.
 *
 * Desktop-first is the instruction, and tablet has to work because that is
 * what a person carries around a dispensary while counting. The failure this
 * catches is the one that survives every unit test: a table wide enough to
 * push the page sideways, so the columns that matter scroll off the edge of
 * the world and nobody notices until UAT.
 */
const VIEWPORTS = [
  { name: 'desktop', width: 1680, height: 1000 },
  { name: 'ipad-landscape', width: 1194, height: 834 },
  { name: 'ipad-portrait', width: 834, height: 1194 },
] as const;

for (const viewport of VIEWPORTS) {
  test(`the page body never scrolls sideways at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await loginAdmin(page);

    const offenders: string[] = [];
    for (const route of ADMIN_ROUTES) {
      await gotoAdmin(page, route.path);
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return doc.scrollWidth - doc.clientWidth;
      });
      // A wide table scrolls INSIDE its own container; the page must not.
      // One pixel of slack for sub-pixel layout rounding.
      if (overflow > 1) offenders.push(`${location.pathname} overflows by ${overflow}px`);
      if (overflow > 1) offenders[offenders.length - 1] = `${route.path} overflows by ${overflow}px`;
    }
    expect(offenders).toEqual([]);
  });
}
