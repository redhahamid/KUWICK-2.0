import { expect, test } from '@playwright/test';
import {
  ADMIN_MOUNTED_ROUTES,
  ADMIN_VIEW_ROUTES,
  collectAdminConsoleErrors,
  gotoAdmin,
  loginAdmin,
} from './support/admin';

/**
 * ONE KUWICK ADMIN, NOT TWO PRODUCTS.
 *
 * The owner's finding was specific and behavioural: reaching item pricing from
 * Admin ▸ Stock meant leaving Admin and arriving in what felt like a different
 * application. The fix was to mount the existing component here rather than
 * build a second one, and THAT is what needs a test — because the failure mode
 * of "we mounted it" is silent. A route that 404s, a rail that loses its
 * highlight, a screen that renders its own chrome inside somebody else's: none
 * of those throw, and all of them put the owner back where they started.
 *
 * These specs do not check that the screens are pretty. They check the four
 * things that make them one product: the route resolves, the Admin rail is
 * still there, the correct sub-tab is lit, and the old URL still works.
 */
test.describe('Admin integration', () => {
  test('every mounted screen renders inside the Admin shell with its rail intact', async ({ page }) => {
    const errors = collectAdminConsoleErrors(page);
    await loginAdmin(page);

    for (const route of ADMIN_MOUNTED_ROUTES) {
      await page.goto(route.path);
      // The Admin hub's own header, from a screen that was written for another
      // hub entirely. If this is missing the page rendered standalone.
      await expect(page.getByRole('heading', { name: 'Administration', exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.locator('.ant-spin-spinning')).toHaveCount(0, { timeout: 30_000 });

      // All five modules reachable from here, so a person can cross between
      // them without going back out to a hub.
      for (const module of ['Operation', 'Stock', 'Panel', 'HR', 'Finance']) {
        await expect(page.getByRole('tab', { name: module, exact: true })).toBeVisible();
      }

      // THE SUB-TAB IS LIT. This is the assertion that would have caught the
      // `?view=` nav entries: they navigated correctly and highlighted
      // nothing, which reads to a user as a dead link.
      const tab = page.getByRole('tab', { name: route.tab, exact: true });
      await expect(tab).toHaveAttribute('aria-selected', 'true');

      // And the screen itself actually drew — not an empty frame.
      await expect(page.getByText(route.marker).first()).toBeVisible({ timeout: 20_000 });
    }

    expect(errors).toEqual([]);
  });

  test('near expiry and slow moving are views of the attention board, not copies of it', async ({ page }) => {
    await loginAdmin(page);

    for (const route of ADMIN_VIEW_ROUTES) {
      await gotoAdmin(page, route.path);
      await expect(page.getByRole('tab', { name: route.tab, exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      // Same board, same heading — the prop changed which question it opens
      // on, and that is all it changed.
      await expect(page.locator('.kw-admin__title')).toHaveText('Stock');
    }
  });

  test('the old Management and Settings URLs still work', async ({ page }) => {
    await loginAdmin(page);

    // Mounting a screen in Admin must not have moved it. Bookmarks, the
    // redirects in App.tsx and every link in the existing product all point at
    // these, and a "consolidation" that breaks them is a regression.
    const originals = [
      ['/management/stock/items', 'Inventory'],
      ['/management/stock/purchase-orders', 'Purchase Orders'],
      ['/management/hr/leave-requests', 'Leave Requests'],
      ['/management/panel/clinics', 'Panel Companies'],
      ['/settings/organisation/roles', 'Roles & permissions'],
    ] as const;

    for (const [path, marker] of originals) {
      await page.goto(path);
      await expect(page.locator('.ant-spin-spinning')).toHaveCount(0, { timeout: 30_000 });
      await expect(page.getByText(marker).first()).toBeVisible({ timeout: 20_000 });
      // Still the MANAGEMENT hub, not Admin — the screen has two doors, and
      // this one leads where it always did.
      await expect(page).toHaveURL(new RegExp(path.replace(/\//g, '\\/')));
    }
  });
});

/**
 * THE DAY-END, DRIVEN.
 *
 * The owner called this owner-critical, and a screenshot of a form is not
 * proof. This counts the drawer short, watches the close be refused, explains
 * the difference, closes the day, and checks the result is actually locked.
 *
 * It runs LAST in this file and mutates the seeded day, which is why it lives
 * beside the read-only specs rather than inside them: everything above is
 * repeatable against any state, and this one is not.
 */
test.describe('Day-end closing, end to end', () => {
  test('counting short forces an explanation, and closing freezes the day', async ({ page }) => {
    await loginAdmin(page);
    await gotoAdmin(page, '/admin/finance/day-end');

    // The seed leaves TODAY open at Contoh Central with takings in all four
    // buckets and a refund already netted off card.
    const status = page
      .locator('.kw-stat', { has: page.locator('.kw-stat__label', { hasText: /^STATUS$/i }) })
      .locator('.kw-stat__value');
    if ((await status.innerText()) !== 'Open') {
      test.skip(true, 'today is already counted or closed — re-run the admin UAT seed');
    }

    // Read expected off the screen rather than recomputing it. A test that
    // derives its own expectation can agree with itself while disagreeing with
    // the product.
    const expectedOf = async (label: string) => {
      const row = page.locator('.kw-countRow').filter({ has: page.getByLabel(`Counted ${label}`) });
      return Number((await row.locator('.kw-countRow__expected').innerText()).replace(/[^0-9.-]/g, ''));
    };
    const cash = await expectedOf('Cash');
    const card = await expectedOf('Card');
    const qr = await expectedOf('QR');
    const other = await expectedOf('Other');
    expect(cash).toBeGreaterThan(20);
    expect(card).toBeGreaterThan(0);
    expect(qr).toBeGreaterThan(0);
    expect(other).toBeGreaterThan(0);

    // A PANEL invoice bills but puts nothing in a drawer, so it must not be in
    // the expected total. The movements table shows it; the buckets do not.
    const expectedTotal = Number(
      (
        await page
          .locator('.kw-stat', { has: page.locator('.kw-stat__label', { hasText: /^EXPECTED TOTAL$/i }) })
          .locator('.kw-stat__value')
          .innerText()
      ).replace(/[^0-9.-]/g, ''),
    );
    expect(expectedTotal).toBeCloseTo(cash + card + qr + other, 2);

    // Count RM20 short on cash, everything else exactly.
    await page.getByLabel('Counted Cash').fill((cash - 20).toFixed(2));
    await page.getByLabel('Counted Card').fill(card.toFixed(2));
    await page.getByLabel('Counted QR').fill(qr.toFixed(2));
    await page.getByLabel('Counted Other').fill(other.toFixed(2));

    // The variance appears, and the screen says the day cannot close without
    // an explanation.
    await expect(page.getByText(/differs from the ledger by -RM20\.00/)).toBeVisible();

    await page
      .getByLabel('Reason for the variance')
      .fill('RM20 short — change given from the drawer for a supplier delivery, receipt in the tin.');
    await page.getByRole('button', { name: 'Save count' }).click();
    await expect(page.locator('.ant-spin-spinning')).toHaveCount(0, { timeout: 30_000 });

    await page.getByRole('button', { name: 'Close the day' }).click();
    // The closing banner specifically, not "any notice on the page" — a closed
    // day carries several, and matching the first one that happens to render
    // makes this assertion about ordering rather than about closing.
    await expect(page.getByText(/FROZEN at closing/i)).toBeVisible({ timeout: 30_000 });

    // CLOSED MEANS CLOSED. Both write buttons are dead, and the count boxes
    // cannot be edited back.
    //
    // Matched by SUBSTRING, not anchored: antd puts a spinner inside a loading
    // button, which makes its accessible name "loading Save count" — so an
    // anchored `/^Save count$/` stopped finding a button that was right there
    // and correctly disabled.
    await expect(page.getByRole('button', { name: 'Save count' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Close the day' })).toBeDisabled();
    await expect(page.getByLabel('Counted Cash')).toBeDisabled();
    // Reopening exists, needs its own permission, and leaves its own record.
    await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible();

    // The refund is still reported on the closed day. This read zero for a day
    // whose own movements table listed a refund, because the frozen columns
    // carry no refund total and a zero stood in for one.
    const refunded = page
      .locator('.kw-stat', { has: page.locator('.kw-stat__label', { hasText: /^REFUNDED$/i }) })
      .locator('.kw-stat__value');
    expect(Number((await refunded.innerText()).replace(/[^0-9.-]/g, ''))).toBeGreaterThan(0);
  });
});

/**
 * PROFITABILITY REFUSING TO GUESS.
 *
 * The one rule the brief states twice: a procedure with no cost basis shows
 * COST NOT CONFIGURED and is not treated as RM0 cost. Silently costing an
 * unknown at zero reports every procedure as pure profit, and this is the spec
 * that stops that regressing.
 */
test.describe('Profitability', () => {
  test('a procedure with no cost basis is never reported as profitable', async ({ page }) => {
    await loginAdmin(page);
    await gotoAdmin(page, '/admin/finance/profitability');

    await page.getByText('Services & procedures', { exact: true }).click();
    await expect(page.locator('.ant-spin-spinning')).toHaveCount(0, { timeout: 30_000 });

    const rows = page.locator('.kw-dataTable .ant-table-tbody tr.ant-table-row');
    await expect(rows.first()).toBeVisible({ timeout: 20_000 });

    // EVERY row says so — and the margin column is a dash, not 100%.
    //
    // Scoped to table CELLS. A bare `getByText('COST NOT CONFIGURED')` also
    // matches the two page-level notices that explain the rule, so it reported
    // "8 flagged of 6 rows" on a screen where all six rows were correct.
    const flagged = page.locator('.kw-dataTable .ant-table-tbody td', { hasText: 'COST NOT CONFIGURED' });
    await expect
      .poll(
        async () => {
          const [rowCount, flaggedCount] = await Promise.all([rows.count(), flagged.count()]);
          return rowCount > 0 && rowCount === flaggedCount
            ? 'every row flagged'
            : `${flaggedCount} flagged of ${rowCount}`;
        },
        { timeout: 20_000 },
      )
      .toBe('every row flagged');
    await expect(page.getByText(/100(\.0)?%/)).toHaveCount(0);

    // The totals refuse too: contribution cannot be computed from no cost.
    const contribution = page
      .locator('.kw-stat', { has: page.locator('.kw-stat__label', { hasText: /^CONTRIBUTION$/i }) })
      .locator('.kw-stat__value');
    await expect(contribution).toHaveText('—');

    // Drugs DO have a cost basis, so the same screen produces real figures —
    // proving the dashes above are a fact about services, not a broken page.
    await page.getByText('Drugs', { exact: true }).click();
    await expect(page.locator('.ant-spin-spinning')).toHaveCount(0, { timeout: 30_000 });
    await expect(contribution).not.toHaveText('—');
    await expect(flagged).toHaveCount(0);
  });
});
