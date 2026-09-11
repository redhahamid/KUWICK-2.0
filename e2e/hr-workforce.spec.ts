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
      await gotoAdmin(page, '/admin/hr/today');

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
    await gotoAdmin(page, '/admin/hr/today');

    // A counter that goes nowhere tells a manager they have work and not where
    // it is, which is most of the way to not doing it.
    for (const [label, path] of [
      ['Leave requests waiting', '/admin/hr/leave'],
      ['Claims waiting for a decision', '/admin/hr/claims'],
    ] as const) {
      await gotoAdmin(page, '/admin/hr/today');
      // A named row rather than a counter tile — see admin-hr.spec.ts for why.
      const tile = page.locator('.kw-panelRow', { hasText: label });
      await expect(tile).toBeVisible();
      await tile.click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
    }
  });

  test('renders without a console error on a two-branch clinic', async ({ page }) => {
    const errors = collectAdminConsoleErrors(page);
    await loginAdmin(page);
    await gotoAdmin(page, '/admin/hr/today');
    await expect(page.locator('.kw-admin__title')).toHaveText('Today');
    await chooseBranch(page, 'Contoh Central');
    await expect(page.locator('.kw-admin__title')).toHaveText('Today');
    // A page that white-screens because a response field is absent is a worse
    // failure than a missing section, and this caught exactly that once.
    await expect(page.locator('.kw-adminError')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe('The roster holds the whole clinic', () => {
  test('the workforce filter is on the board and counts everybody', async ({ page }) => {
    await loginAdmin(page);
    await gotoAdmin(page, '/admin/hr/attendance/roster');
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

  test('opens with today fully visible, not tucked under the provider rail', async ({ page }) => {
    await loginAdmin(page);
    await gotoAdmin(page, '/admin/hr/attendance/roster');
    await chooseBranch(page, 'Contoh Central');

    const today = page.locator('th[data-today]');
    // A month that does not contain today has nothing to assert here.
    if ((await today.count()) === 0) test.skip();

    // The board auto-scrolls to today. It used to compute that scroll from
    // `offsetLeft`, which is measured from <body> for a static table, so the
    // hub's 32px inset was counted twice and today's column opened a third of
    // its width UNDER the sticky provider rail — the one date a manager came
    // to look at was the one partly hidden.
    const geometry = await page.evaluate(() => {
      const th = document.querySelector('th[data-today]') as HTMLElement;
      const rail = document.querySelector('.kw-roster-provider-head') as HTMLElement;
      return { columnLeft: th.getBoundingClientRect().left, railRight: rail.getBoundingClientRect().right };
    });
    // Flush or clear of the rail, never behind it. One pixel of tolerance for
    // sub-pixel layout.
    expect(geometry.columnLeft).toBeGreaterThanOrEqual(geometry.railRight - 1);
  });
});

test.describe('A roster belongs to one branch', () => {
  test('the branch question is answerable where it is asked', async ({ page }) => {
    await loginAdmin(page);
    // The Admin hub opens on "All branches" and a roster is one branch's board,
    // so this screen has a question to ask first. It used to ask it as a bare
    // "Choose a branch to see its roster" over an empty page, with the only
    // control for answering it in the hub header above the tabs — where
    // somebody staring at an empty board is not looking.
    await page.evaluate(() => window.sessionStorage.removeItem('kuwick.selectedBranch'));
    await gotoAdmin(page, '/admin/hr/attendance/roster');

    const notice = page.locator('.kw-adminNotice', { hasText: 'A roster belongs to one branch' });
    await expect(notice).toBeVisible();

    const choices = notice.getByRole('button');
    expect(await choices.count()).toBeGreaterThan(1);
    await choices.first().click();

    // And answering it draws the board.
    await expect(page.locator('.kw-roster-filters')).toBeVisible();
  });
});

test.describe('What "late" means here', () => {
  test('the clinic can set its own attendance rules, and the answer survives a reload', async ({ page }) => {
    // These numbers were constants in the attendance calculation, which made
    // one of every two clinics' timesheets a fiction: a 24-hour clinic and a
    // nine-to-five practice do not agree about when 09:06 is late.
    await loginAdmin(page);
    await gotoAdmin(page, '/admin/hr/settings/attendance');

    const panel = page.locator('.kw-adminSection', { hasText: 'Attendance rules' });
    await expect(panel).toBeVisible();
    // The screen SAYS which of the three answers is in force, because "why is
    // this branch different" is the first question anybody asks.
    await expect(panel.locator('.ant-tag').first()).toContainText('In force:');

    const lateGrace = panel.locator('.ant-input-number-input').first();
    const original = await lateGrace.inputValue();
    const changed = String(Number(original) + 3);

    await lateGrace.fill(changed);
    await panel.getByRole('button', { name: 'Save attendance rules' }).click();
    await expect(page.locator('.ant-spin-spinning')).toHaveCount(0, { timeout: 30_000 });

    await page.reload();
    await expect(page.locator('.ant-spin-spinning')).toHaveCount(0, { timeout: 30_000 });
    const reloaded = page.locator('.kw-adminSection', { hasText: 'Attendance rules' });
    await expect(reloaded.locator('.ant-input-number-input').first()).toHaveValue(changed);

    // Put it back, so a test does not leave the clinic measuring by something
    // nobody chose.
    await reloaded.locator('.ant-input-number-input').first().fill(original);
    await reloaded.getByRole('button', { name: 'Save attendance rules' }).click();
    await expect(page.locator('.ant-spin-spinning')).toHaveCount(0, { timeout: 30_000 });
  });

  test('the order of minimum and rounding is stated on the screen, not only in the code', async ({ page }) => {
    // Twelve minutes over on a fifteen-minute minimum is not overtime. Rounding
    // first and comparing second would pay it — the kind of difference nobody
    // notices for a year and then notices for every month of that year.
    await loginAdmin(page);
    await gotoAdmin(page, '/admin/hr/settings/attendance');
    const panel = page.locator('.kw-adminSection', { hasText: 'Attendance rules' });
    await expect(panel).toContainText('The minimum is applied before the rounding');
  });
});
