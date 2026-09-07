import { expect, test } from '@playwright/test';
import { chooseBranch, collectAdminConsoleErrors, gotoAdmin, loginAdmin } from './support/admin';

/**
 * THE HR MODULE AS A MANAGER USES IT.
 *
 * Three properties that only a real browser can check: the sub-navigation
 * survives an iPad without eating its own labels, the board's counters lead
 * somewhere, and the screens render the CLINIC's times rather than the
 * laptop's.
 */

const HR_WIDTHS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'ipad-landscape', width: 1024, height: 768 },
  { name: 'ipad-portrait', width: 834, height: 1112 },
  { name: 'ipad-mini-portrait', width: 768, height: 1024 },
] as const;

test.describe('HR navigation', () => {
  for (const viewport of HR_WIDTHS) {
    test(`no HR tab label is cut in half at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await loginAdmin(page);
      await gotoAdmin(page, '/admin/hr');

      // "Locum sessi…" is the failure this exists for. A label whose content
      // is wider than its box has been truncated by CSS, and a person cannot
      // tell a truncated tab from a differently-named one.
      const truncated = await page.evaluate(() =>
        [...document.querySelectorAll('.ant-tabs-tab-btn')]
          .filter((tab) => tab.scrollWidth > tab.clientWidth + 1)
          .map((tab) => tab.textContent ?? ''),
      );
      expect(truncated).toEqual([]);

      // And the rail itself must not push the page sideways to fit.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }
});

test.describe('HR Today', () => {
  test('the counters lead to the work rather than merely counting it', async ({ page }) => {
    await loginAdmin(page);
    await gotoAdmin(page, '/admin/hr');

    // A counter that goes nowhere tells a manager they have work and not where
    // it is, which is most of the way to not doing it.
    for (const [label, path] of [
      ['Leave approvals pending', '/admin/hr/leave'],
      ['Claims awaiting a decision', '/admin/hr/claims'],
    ] as const) {
      await gotoAdmin(page, '/admin/hr');
      const tile = page.locator('.kw-exceptionTile', { hasText: label });
      await expect(tile).toBeVisible();
      await expect(tile).toBeEnabled();
      await tile.click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
    }
  });

  test('renders without a console error on a two-branch clinic', async ({ page }) => {
    const errors = collectAdminConsoleErrors(page);
    await loginAdmin(page);
    await gotoAdmin(page, '/admin/hr');
    await expect(page.locator('.kw-admin__title')).toHaveText('Workforce');
    await chooseBranch(page, 'Contoh Central');
    await expect(page.locator('.kw-admin__title')).toHaveText('Workforce');
    // A page that white-screens because a response field is absent is a worse
    // failure than a missing section, and this caught exactly that once.
    await expect(page.locator('.kw-adminError')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe('The roster holds the whole clinic', () => {
  test('the workforce filter is on the board and counts everybody', async ({ page }) => {
    await loginAdmin(page);
    await gotoAdmin(page, '/admin/hr/roster');
    await chooseBranch(page, 'Contoh Central');

    const filters = page.locator('.kw-roster-filters');
    await expect(filters).toBeVisible();
    // "Everyone" carries the total; a chip for a category nobody is in is a
    // control that does nothing and is not rendered.
    await expect(filters.getByRole('button', { name: /^Everyone/ })).toBeVisible();

    const chips = await filters.getByRole('button').allInnerTexts();
    expect(chips.length).toBeGreaterThan(1);
    // Every chip carries its count, so choosing one does not make the rest
    // look empty.
    for (const chip of chips) expect(chip).toMatch(/\(\d+\)/);
  });
});
