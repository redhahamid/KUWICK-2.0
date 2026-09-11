import { expect, test, type Page } from '@playwright/test';
import { gotoAdmin, loginAdmin } from './support/admin';

/**
 * `gotoAdmin` waits for `.kw-admin`, the wrapper `AdminShell` draws. Public
 * Holidays was written for Clinic Settings and draws `PageHeader` instead, so
 * it has no `.kw-admin` even though it is an HR settings screen like the other
 * five. What IS true of every HR address, whichever shell the screen uses, is
 * the rail — and the rail is what this spec is about.
 */
async function gotoHr(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator('.kw-hubRail__item').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.ant-spin-spinning')).toHaveCount(0, { timeout: 30_000 });
}

/**
 * THE FIVE-SECTION HR ARCHITECTURE, AND EVERY URL IT ABSORBED.
 *
 * HR used to carry twelve top-level entries: Today, Employees, Timesheets,
 * Leave, Claims, Roster, Payroll, Doctor incentives, Locum sessions, Staff
 * benefits, Reports, Payroll settings. It was a map of the domain model rather
 * than of the work, and the owner who commissioned the system was still asking
 * why there were so many tabs.
 *
 * It went to six, and then to FIVE: Medical Benefits is a benefits workflow
 * opened when a claim or an entitlement question comes up, not a place
 * somebody goes weekly, and a permanent seat beside Payroll made it look like
 * a sixth kind of monthly work. It moved under the section that owns the
 * employee record — reached the same way Roster is reached from Attendance.
 *
 * Plus Settings, kept apart because it is set up once and rarely opened.
 * Nothing was deleted — every old URL still resolves — and this spec is the
 * contract for both halves of that sentence.
 */

const SECTIONS = ['Employees', 'Payroll', 'Attendance', 'Leave', 'Claims', 'Reports'];

test.describe('the HR rail', () => {
  test('offers six sections, with Settings apart from them', async ({ page }) => {
    await loginAdmin(page);
    await gotoAdmin(page, '/admin/hr/payroll');

    const rail = page.locator('.kw-hubRail__item');
    await expect(rail).toHaveCount(SECTIONS.length + 1);
    expect((await rail.allInnerTexts()).map((label) => label.trim())).toEqual([...SECTIONS, 'Settings']);

    // Settings is visibly not one of the six.
    await expect(page.locator('.kw-hubRail__item--settings')).toHaveText('Settings');
  });

  test('lights the section you are standing in, on every one', async ({ page }) => {
    await loginAdmin(page);
    for (const [path, section] of [
      ['/admin/hr/employees', 'Employees'],
      ['/admin/hr/payroll', 'Payroll'],
      ['/admin/hr/attendance', 'Attendance'],
      ['/admin/hr/attendance/roster', 'Attendance'],
      ['/admin/hr/leave', 'Leave'],
      ['/admin/hr/claims', 'Claims'],
      ['/admin/hr/reports', 'Reports'],
      // Benefits belongs to the employee record now, and lights it.
      ['/admin/hr/benefits', 'Employees'],
      // Settings lit Overview until the active-path resolution learned that a
      // section list is not the whole set of destinations.
      ['/admin/hr/settings', 'Settings'],
      // Settings is a landing with areas under it now, and each area is still
      // Settings — not the section its subject happens to belong to.
      ['/admin/hr/settings/payroll', 'Settings'],
      ['/admin/hr/settings/attendance-leave', 'Settings'],
      ['/admin/hr/settings/company', 'Settings'],
      ['/admin/hr/settings/payroll-items', 'Settings'],
      ['/admin/hr/settings/public-holidays', 'Settings'],
      ['/admin/hr/settings/opening-balances', 'Settings'],
      // Hiring is a full page rather than a drawer, and it belongs to Employees.
      ['/admin/hr/employees/new', 'Employees'],
    ] as const) {
      await gotoHr(page, path);
      await expect(page.locator('.kw-hubRail__item.is-active'), `${path} should light ${section}`).toHaveText(section);
    }

    // Today is inside HR but is not one of the seven, so the rail lights
    // NOTHING — while still being HR's rail. It used to render under
    // Operation's tabs entirely, because an unclaimed route had no module.
    await gotoHr(page, '/admin/hr/today');
    await expect(page.locator('.kw-hubRail__heading')).toHaveText('HR');
    await expect(page.locator('.kw-hubRail__item.is-active')).toHaveCount(0);
  });
});

test.describe('every URL the six sections absorbed', () => {
  test('still resolves, and lands on the screen that now owns it', async ({ page }) => {
    await loginAdmin(page);
    // Links to these are in the user guide, in payroll exception remedies and
    // in people's bookmarks. A dead one teaches somebody the product moved on
    // without them.
    for (const [old, destination, heading] of [
      // HR opens on Payroll; the old landing keeps its own address.
      ['/admin/hr', '/admin/hr/payroll', 'Payroll'],
      ['/admin/hr/people', '/admin/hr/employees', 'Employees'],
      ['/admin/hr/people/new', '/admin/hr/employees/new', 'Add employee'],
      ['/admin/hr/time', '/admin/hr/attendance', 'Attendance'],
      ['/admin/hr/time/roster', '/admin/hr/attendance/roster', 'Roster'],
      ['/admin/hr/roster', '/admin/hr/attendance/roster', 'Roster'],
      ['/admin/hr/schedule', '/admin/hr/attendance/roster', 'Roster'],
      ['/admin/hr/time/leave', '/admin/hr/leave', 'Leave'],
      ['/admin/hr/requests', '/admin/hr/leave', 'Leave'],
      ['/admin/hr/time/claims', '/admin/hr/claims', 'Claims'],
      // Settings moved into one place under HR, and Roles left for the one
      // home it should always have had.
      ['/admin/hr/employers', '/admin/hr/settings/company', 'Legal employers'],
      ['/admin/hr/settings/attendance', '/admin/hr/settings/attendance-leave', 'Attendance rules'],
      ['/admin/hr/payroll/ytd-opening', '/admin/hr/settings/opening-balances', 'Opening balances'],
      ['/settings/hr/public-holidays', '/admin/hr/settings/public-holidays', 'Public Holidays'],
      // Readiness was a page listing who was not ready; it is now a status on
      // each person's own register row, so the URL lands on the register.
      ['/admin/hr/payroll/readiness', '/admin/hr/payroll', 'Payroll'],
      // The all-runs archive is History, reached from beside the month picker.
      ['/admin/hr/payroll/all', '/admin/hr/payroll/history', 'Payroll history'],
      // The Management-era HR screens. Each was a SECOND screen over the same
      // facts; the address is all that survives them.
      ['/management/hr/staff', '/admin/hr/employees', 'Employees'],
      ['/management/hr/attendance', '/admin/hr/attendance', 'Attendance'],
      ['/management/hr/leave-requests', '/admin/hr/leave', 'Leave'],
      ['/management/hr/public-holidays', '/admin/hr/settings/public-holidays', 'Public Holidays'],
    ] as const) {
      await gotoHr(page, old);
      expect(new URL(page.url()).pathname, `${old} should land on ${destination}`).toBe(destination);
      // By ROLE, not by the Admin shell's own class: Public Holidays was
      // written for Clinic Settings and renders its title through PageHeader.
      // Both shells emit a real heading, which is what a reader sees.
      await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible();
    }
  });

  test('sends the old HR access screen to the one place roles live', async ({ page }) => {
    await loginAdmin(page);
    // `/admin/hr/access` rendered the product-wide Roles screen inside the HR
    // hub, so two screens could disagree about who may approve a payroll. It
    // leaves HR entirely, which is why it is asserted apart from the table
    // above: it lands in Settings' shell, not the Admin one.
    await page.goto('/admin/hr/access');
    expect(new URL(page.url()).pathname).toBe('/settings/organisation/roles');
    await expect(page.getByRole('heading', { name: 'Roles & permissions', exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
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

    // SIX AREAS, each a thing decided once. They were four, and two of the six
    // were not reachable from here at all: Public Holidays lived in Clinic
    // Settings under a near-empty "HR & Attendance" category, and the pay
    // components had no screen anywhere.
    expect(
      (await page.locator('.kw-reportCard__title').allInnerTexts()).map((label) => label.trim()),
    ).toEqual([
      'Company & statutory',
      'Payroll items',
      'Payroll policies',
      'Attendance & leave policies',
      'Public holidays',
      'Opening balances',
    ]);

    // Each card opens its own page. The destination's own title is asserted
    // rather than the card's label: the two do not read identically yet, and a
    // test that hid that would be hiding it from the next piece of work too.
    for (const [name, path, heading] of [
      ['Payroll items', '/admin/hr/settings/payroll-items', 'Payroll items'],
      ['Payroll policies', '/admin/hr/settings/payroll', 'Payroll rules'],
      ['Attendance & leave policies', '/admin/hr/settings/attendance-leave', 'Attendance rules'],
      ['Public holidays', '/admin/hr/settings/public-holidays', 'Public Holidays'],
    ] as const) {
      await gotoHr(page, '/admin/hr/settings');
      await page.locator('.kw-reportCard', { hasText: name }).first().click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible();
      // And you are still in Settings, not in the section the subject belongs to.
      await expect(page.locator('.kw-hubRail__item.is-active')).toHaveText('Settings');
    }
  });
});

test.describe('Attendance carries the roster', () => {
  test('has two views — was somebody meant to work, and did they', async ({ page }) => {
    await loginAdmin(page);
    await gotoAdmin(page, '/admin/hr/attendance');

    // It used to be four: Attendance, Roster, Leave, Claims, behind one rail
    // entry called "Time & Leave". Leave and Claims are separate decisions and
    // have their own entries now, so two of the three stopped being invisible.
    const views = page.locator('.kw-workAreaTabs label');
    expect((await views.allInnerTexts()).map((label) => label.trim())).toEqual(['Timesheet', 'Roster']);

    await views.filter({ hasText: 'Roster' }).click();
    await expect(page).toHaveURL(/\/admin\/hr\/attendance\/roster$/);
    await expect(page.locator('.kw-hubRail__item.is-active')).toHaveText('Attendance');
  });

  test('gives Leave and Claims rail entries of their own', async ({ page }) => {
    await loginAdmin(page);
    for (const [path, section] of [
      ['/admin/hr/leave', 'Leave'],
      ['/admin/hr/claims', 'Claims'],
    ] as const) {
      await gotoHr(page, path);
      await expect(page.locator('.kw-hubRail__item.is-active')).toHaveText(section);
      // Neither is a VIEW of Attendance any more. Both still carry a switcher
      // of their own — Requests / Calendar / Balances on Leave — which is an
      // in-page view, not a place in the navigation.
      const labels = (await page.locator('.kw-workAreaTabs label').allInnerTexts()).map((label) => label.trim());
      expect({ path, labels }).toEqual({ path, labels: expect.not.arrayContaining(['Timesheet', 'Roster']) });
    }
  });
});
