import { expect, test } from '@playwright/test';
import {
  ADMIN_ACCOUNTS,
  collectAdminConsoleErrors,
  gotoAdmin,
  loginAdmin,
  statValue,
} from './support/admin';

/**
 * SCENARIO 6 — an employee, their hours, and a payroll run.
 *
 * The assertion this module lives or dies on is the one about statutory
 * figures. Malaysian EPF, SOCSO, EIS and PCB rates are not built into Kuwick,
 * they are configuration a clinic owns and dates, and no rate table exists in
 * this tenant. A payroll screen that filled those columns with plausible
 * numbers would be worse than one that refuses, because somebody would file
 * them. So the refusal is tested as a feature.
 */
test.describe('HR', () => {
  test('the landing page says who is here and what is blocked on a manager', async ({ page }) => {
    const errors = collectAdminConsoleErrors(page);
    await loginAdmin(page, ADMIN_ACCOUNTS.owner);
    await gotoAdmin(page, '/admin/hr');

    await expect(page.getByRole('heading', { name: 'Workforce', exact: true })).toBeVisible();

    // Somebody is actually on the floor, and the roster is read from the
    // canonical provider roster rather than a second HR-only schedule.
    await expect(statValue(page, 'ON DUTY NOW')).not.toHaveText('0');
    await expect(page.getByText(/Read from the provider roster/i)).toBeVisible();
    await expect(page.getByText(/Changing a shift happens there, not here/i)).toBeVisible();

    // Each of the three is a person blocked until a manager acts — the point
    // of putting them above the tables.
    for (const label of ['Leave approvals pending', 'Overtime claimed, not approved', 'Missing clock-in or clock-out']) {
      await expect(page.locator('.kw-exceptionTile__label', { hasText: new RegExp(label) })).toBeVisible();
    }

    expect(errors).toEqual([]);
  });

  test('account, employment and clinical credential stay three separate facts', async ({ page }) => {
    const errors = collectAdminConsoleErrors(page);
    await loginAdmin(page, ADMIN_ACCOUNTS.owner);
    await gotoAdmin(page, '/admin/hr/employees');

    await expect(page.getByRole('heading', { name: 'Employees', exact: true })).toBeVisible();
    await expect(page.getByText(/three separate facts about one person/i)).toBeVisible();

    // A doctor is an employee AND a credentialed clinician; a stock controller
    // is an employee and not a clinician. Collapsing those is how a clinic
    // ends up letting the wrong person sign a prescription.
    await expect(page.getByRole('row', { name: /Dr Aisyah Rahman/ })).toContainText(/may sign/);
    await expect(page.getByRole('row', { name: /Hafiz Osman/ })).toContainText(/Non-clinical/);

    expect(errors).toEqual([]);
  });

  test('unapproved overtime is shown separately and is not paid', async ({ page }) => {
    const errors = collectAdminConsoleErrors(page);
    await loginAdmin(page, ADMIN_ACCOUNTS.owner);
    await gotoAdmin(page, '/admin/hr/attendance');

    await expect(page.getByRole('heading', { name: 'Attendance', exact: true })).toBeVisible();
    // The GUARANTEE, not one wording of it. The subtitle was shortened when
    // the copy was cut back — "shown separately and is not paid" became "is not
    // paid" — and a test that pins the sentence rather than the promise breaks
    // on every edit while proving nothing extra. What must stay true is that
    // unapproved overtime is named as unpaid AND counted in its own column.
    await expect(page.getByText(/Overtime nobody has approved is not paid/i)).toBeVisible();

    // Two columns, deliberately. A long day is not automatically overtime.
    await expect(statValue(page, 'APPROVED OVERTIME')).toBeVisible();
    await expect(statValue(page, 'UNAPPROVED OVERTIME')).toBeVisible();
    await expect(page.getByText(/A long day is not automatically overtime/i)).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('payroll is honest in both directions: computed where it can be, blocked where it cannot', async ({ page }) => {
    const errors = collectAdminConsoleErrors(page);
    await loginAdmin(page, ADMIN_ACCOUNTS.owner);
    await gotoAdmin(page, '/admin/hr/payroll');

    await expect(page.getByRole('heading', { name: 'Payroll', exact: true })).toBeVisible();

    // The month in progress reads as a status, not a promise: CALCULATED. An
    // approved run on unchecked rates would read Provisional here instead of a
    // plain green APPROVED — that substitution is the row-level admission.
    await expect(page.locator('.ant-tag', { hasText: 'CALCULATED' }).first()).toBeVisible();

    /*
     * THE ONE SAFETY INDICATOR — honest in BOTH directions. This spec used to
     * assert a page of red copy including "PCB is not calculated at all" —
     * statements that became FALSE when the MTD engine shipped. It then
     * asserted the one-line "not yet production-ready" banner, which became
     * the same defect the other way up: the banner read the run's STORED
     * status while the registry's schedules covered the period in full, so it
     * cried wolf over every fully covered month. The landing now serves the
     * period's own registry answer, and for the seeded month — every schedule
     * OFFICIAL_SOURCE_VERIFIED — the banner must be ABSENT. A warning that
     * overstates is the same defect as one that understates: the reader who
     * catches it wrong once stops believing the rest of it.
     */
    await expect(page.getByText(/Payroll statutory setup is not yet production-ready/i)).toHaveCount(0);
    await expect(page.getByText(/must not be used to pay staff or file a return/i)).toHaveCount(0);

    // --- THE MONTH, BLOCKED — the exception centre names people, not counts.
    // The home page also links readiness and the archive under /payroll/, so
    // the run is found by the shape of its id, not by position.
    const hrefs = await page
      .locator('a[href*="/admin/hr/payroll/"]')
      .evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute('href')));
    const runId = hrefs
      .map((href) => href?.match(/\/admin\/hr\/payroll\/([0-9a-f-]{36})/)?.[1])
      .find(Boolean);
    expect(runId).toBeTruthy();

    await gotoAdmin(page, `/admin/hr/payroll/${runId}?step=review`);
    await expect(page.getByText(/blocking exception\(s\) must be resolved before this run can be approved/i)).toBeVisible();

    // The person who cannot be paid is NAMED, with the consequence and the
    // remedy in full sentences.
    await expect(page.getByText(/Wan Azman — Salary setup is incomplete/i)).toBeVisible();
    await expect(page.getByText(/left out of the totals entirely rather than paid a figure nobody chose/i)).toBeVisible();

    // PCB's remedy leads with the truthful path: complete the tax profile and
    // the figure is CALCULATED from HASiL's specification. The old copy said
    // "Kuwick does not work out monthly tax for you", which stopped being true
    // when the engine shipped — and stayed on this screen for a while after.
    await expect(page.getByText(/calculated from HASiL/i).first()).toBeVisible();

    // The month's own totals are real computed figures beside the blockers —
    // take-home and employer cost, not zeroes behind an honest-looking banner.
    await expect(page.getByText('TAKE-HOME PAY', { exact: true })).toBeVisible();
    await expect(page.getByText('TOTAL COST TO THE CLINIC', { exact: true })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('a paid incentive is never recalculated with today rules', async ({ page }) => {
    const errors = collectAdminConsoleErrors(page);
    await loginAdmin(page, ADMIN_ACCOUNTS.owner);
    await gotoAdmin(page, '/admin/hr/incentives');

    await expect(page.getByRole('heading', { name: 'Doctor Incentives' })).toBeVisible();
    await expect(page.getByText(/versioned so a paid incentive is never recalculated with today's rules/i)).toBeVisible();
    await expect(page.getByRole('row', { name: /APPROVED/ }).first()).toBeVisible();

    expect(errors).toEqual([]);
  });
});
