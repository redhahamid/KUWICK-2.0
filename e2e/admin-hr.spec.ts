import { expect, test } from '@playwright/test';
import { ADMIN_ACCOUNTS, collectAdminConsoleErrors, gotoAdmin, loginAdmin, statValue } from './support/admin';

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

    await expect(page.getByRole('heading', { name: 'Workforce' })).toBeVisible();

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

    await expect(page.getByRole('heading', { name: 'Timesheets' })).toBeVisible();
    await expect(page.getByText(/Overtime nobody has approved is shown separately and is not paid/i)).toBeVisible();

    // Two columns, deliberately. A long day is not automatically overtime.
    await expect(statValue(page, 'APPROVED OVERTIME')).toBeVisible();
    await expect(statValue(page, 'UNAPPROVED OVERTIME')).toBeVisible();
    await expect(page.getByText(/A long day is not automatically overtime/i)).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('payroll refuses to invent a statutory figure it cannot stand behind', async ({ page }) => {
    const errors = collectAdminConsoleErrors(page);
    await loginAdmin(page, ADMIN_ACCOUNTS.owner);
    await gotoAdmin(page, '/admin/hr/payroll');

    await expect(page.getByRole('heading', { name: 'Payroll', exact: true })).toBeVisible();

    // The whole point, stated where the person about to approve a run reads it.
    await expect(page.getByText(/No statutory rate tables are configured/i)).toBeVisible();
    await expect(page.getByText(/are NOT built into this system/i)).toBeVisible();
    await expect(page.getByText(/rather than presenting a plausible wrong figure/i)).toBeVisible();

    // And the run itself carries the same admission in its own row, so it
    // travels with the figure rather than living only in a banner.
    await expect(page.getByRole('row', { name: /2026-07/ })).toContainText(/Not calculated/);

    // The exception count is a person who cannot be paid yet, not a warning.
    await expect(page.getByRole('row', { name: /2026-07/ })).toContainText(/1/);

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
