import { expect, test } from '@playwright/test';
import { gotoAdmin, loginAdmin } from './support/admin';

/**
 * THE SIX-SECTION HR ARCHITECTURE, AND EVERY URL IT ABSORBED.
 *
 * HR used to carry twelve top-level entries: Today, Employees, Timesheets,
 * Leave, Claims, Roster, Payroll, Doctor incentives, Locum sessions, Staff
 * benefits, Reports, Payroll settings. It was a map of the domain model rather
 * than of the work, and the owner who commissioned the system was still asking
 * why there were so many tabs.
 *
 * Six now, plus Settings kept apart because it is set up once and rarely
 * opened. Nothing was deleted — every old URL still resolves — and this spec
 * is the contract for both halves of that sentence.
 */

const SECTIONS = ['Overview', 'People', 'Time & Leave', 'Payroll', 'Medical Benefits', 'Reports'];

test.describe('the HR rail', () => {
  test('offers six sections, with Settings apart from them', async ({ page }) => {
    await loginAdmin(page);
    await gotoAdmin(page, '/admin/hr');

    const rail = page.locator('.kw-hubRail__item');
    await expect(rail).toHaveCount(SECTIONS.length + 1);
    expect((await rail.allInnerTexts()).map((label) => label.trim())).toEqual([...SECTIONS, 'Settings']);

    // Settings is visibly not one of the six.
    await expect(page.locator('.kw-hubRail__item--settings')).toHaveText('Settings');
  });

  test('lights the section you are standing in, on every one', async ({ page }) => {
    await loginAdmin(page);
    for (const [path, section] of [
      ['/admin/hr', 'Overview'],
      ['/admin/hr/people', 'People'],
      ['/admin/hr/time', 'Time & Leave'],
      ['/admin/hr/time/roster', 'Time & Leave'],
      ['/admin/hr/time/leave', 'Time & Leave'],
      ['/admin/hr/time/claims', 'Time & Leave'],
      ['/admin/hr/payroll', 'Payroll'],
      ['/admin/hr/benefits', 'Medical Benefits'],
      ['/admin/hr/reports', 'Reports'],
      // Settings lit Overview until the active-path resolution learned that a
      // section list is not the whole set of destinations.
      ['/admin/hr/settings', 'Settings'],
      // Settings is a landing with areas under it now, and each area is still
      // Settings — not the section its subject happens to belong to.
      ['/admin/hr/settings/payroll', 'Settings'],
      ['/admin/hr/settings/attendance', 'Settings'],
      // Hiring is a full page rather than a drawer, and it belongs to People.
      ['/admin/hr/people/new', 'People'],
    ] as const) {
      await gotoAdmin(page, path);
      await expect(page.locator('.kw-hubRail__item.is-active'), `${path} should light ${section}`).toHaveText(section);
    }
  });
});

test.describe('every URL the six sections absorbed', () => {
  test('still resolves, and lands on the screen that now owns it', async ({ page }) => {
    await loginAdmin(page);
    // Links to these are in the user guide, in payroll exception remedies and
    // in people's bookmarks. A dead one teaches somebody the product moved on
    // without them.
    for (const [old, destination, heading] of [
      ['/admin/hr/employees', '/admin/hr/people', 'People'],
      ['/admin/hr/attendance', '/admin/hr/time', 'Attendance'],
      ['/admin/hr/roster', '/admin/hr/time/roster', 'Roster'],
      ['/admin/hr/schedule', '/admin/hr/time/roster', 'Roster'],
      ['/admin/hr/leave', '/admin/hr/time/leave', 'Leave'],
      ['/admin/hr/requests', '/admin/hr/time/leave', 'Leave'],
      ['/admin/hr/claims', '/admin/hr/time/claims', 'Claims'],
    ] as const) {
      await page.goto(old);
      await expect(page.locator('.kw-admin')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('.ant-spin-spinning')).toHaveCount(0, { timeout: 30_000 });
      expect(new URL(page.url()).pathname, `${old} should land on ${destination}`).toBe(destination);
      await expect(page.locator('.kw-admin__title')).toHaveText(heading);
    }
  });

  test('keeps the payroll inputs reachable, inside Payroll rather than beside it', async ({ page }) => {
    await loginAdmin(page);
    // Doctor incentives and locum sessions were top-level tabs. They are pay
    // INPUTS: things that feed a payslip, not places you go. They keep their
    // URLs and now light Payroll.
    for (const path of ['/admin/hr/incentives', '/admin/hr/locum']) {
      await gotoAdmin(page, path);
      await expect(page.locator('.kw-hubRail__item.is-active'), `${path} belongs to Payroll`).toHaveText('Payroll');
    }
  });
});

test.describe('Settings is a landing, not a wall', () => {
  test('opens on the setup checklist and the areas, with each area on its own page', async ({ page }) => {
    await loginAdmin(page);
    await gotoAdmin(page, '/admin/hr/settings');

    // The checklist is the screen: a clinic that cannot see which of the six
    // is outstanding discovers the answer on pay day.
    await expect(page.locator('.kw-setupList__row')).toHaveCount(6);
    // And the configuration itself is behind cards rather than stacked below.
    await expect(page.locator('.kw-reportCard')).not.toHaveCount(0);

    for (const [name, path, heading] of [
      ['Payroll rules', '/admin/hr/settings/payroll', 'Payroll rules'],
      ['Attendance rules', '/admin/hr/settings/attendance', 'Attendance rules'],
    ] as const) {
      await gotoAdmin(page, '/admin/hr/settings');
      await page.locator('.kw-reportCard', { hasText: name }).first().click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.locator('.kw-admin__title')).toHaveText(heading);
    }
  });
});

test.describe('Time & Leave is one section', () => {
  test('carries its four views, and each one is reachable from the others', async ({ page }) => {
    await loginAdmin(page);
    await gotoAdmin(page, '/admin/hr/time');

    const views = page.locator('.kw-workAreaTabs label');
    expect((await views.allInnerTexts()).map((label) => label.trim())).toEqual([
      'Attendance',
      'Roster',
      'Leave',
      'Claims',
    ]);

    // Attendance and Roster were two top-level tabs answering one question:
    // was somebody meant to work, and did they?
    await views.filter({ hasText: 'Roster' }).click();
    await expect(page).toHaveURL(/\/admin\/hr\/time\/roster$/);
    await expect(page.locator('.kw-hubRail__item.is-active')).toHaveText('Time & Leave');
  });
});
