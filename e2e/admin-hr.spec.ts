import { expect, test } from '@playwright/test';
import {
  ADMIN_ACCOUNTS,
  collectAdminConsoleErrors,
  gotoAdmin,
  loginAdmin,
  seededPayrollPeriod,
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
    // Derived from the same rule the seed uses (`monthStart(-1)`), so this spec
    // stops being correct-for-one-month.
    const period = new RegExp(seededPayrollPeriod());
    const errors = collectAdminConsoleErrors(page);
    await loginAdmin(page, ADMIN_ACCOUNTS.owner);
    await gotoAdmin(page, '/admin/hr/payroll');

    await expect(page.getByRole('heading', { name: 'Payroll', exact: true })).toBeVisible();

    // THE WARNING MUST BE ACCURATE IN BOTH DIRECTIONS, which is why this
    // asserts what IS calculated as well as what is not. EPF, SOCSO and EIS
    // now come from dated band tables; overstating that gap would be the same
    // failure as understating it, because a reader who catches the banner
    // being wrong once stops believing the rest of it.
    await expect(page.getByText(/NOT READY FOR LIVE MALAYSIAN PAYROLL/i)).toBeVisible();
    await expect(page.getByText(/EPF, SOCSO and EIS are calculated/i)).toBeVisible();
    await expect(page.getByText(/nobody has checked those tables/i)).toBeVisible();

    // PCB is the part that genuinely is not implemented, and it says so
    // without hiding behind the others.
    await expect(page.getByText(/PCB is not calculated at all/i)).toBeVisible();

    // No payslip and no bank file, said plainly rather than left to be found.
    await expect(page.getByText(/no payslip and no bank payment file/i)).toBeVisible();

    // And the run itself carries the same admission in its own row, so it
    // travels with the figure rather than living only in a banner.
    await expect(page.getByRole('row', { name: period })).toContainText(/Unverified rates/);

    // Exceptions are people who cannot be paid yet, not a warning.
    await expect(page.getByRole('row', { name: period })).toContainText(/[1-9]/);

    // --- DETAIL, the fourth step of the hierarchy -------------------------
    // Summary → exceptions → work queue → detail. A run whose lines cannot be
    // opened is a total nobody can check. It expands in place rather than in a
    // modal, because the person reading it is comparing it to the row above.
    await page.getByRole('row', { name: period }).click();
    const detail = page.locator('.kw-adminSection', { hasText: 'Contoh Central' }).last();
    await expect(detail.getByRole('heading', { name: new RegExp(`${seededPayrollPeriod()} · Contoh Central`) })).toBeVisible();

    // The person who cannot be paid is NAMED, not counted — an exception count
    // with no name attached is a number somebody approves past.
    await expect(detail.locator('.ant-table-tbody tr.ant-table-row').first()).toBeVisible();

    // A computed statutory figure really is on the line, and the age-60 branch
    // is real: the 61-year-old contributes nothing himself and his employer
    // pays 4%. Asserting a number here is what stops the engine silently
    // regressing to zeros behind an honest-looking banner.
    //
    // SCOPED TO THE LINES TABLE, by the one column only it has. The detail
    // section holds three tables now — the pay lines, the exception centre and
    // the variance panel — and every employee appears in two of them, so a
    // bare name matches twice. It matched twice before this too: the variance
    // panel loads on its own request, and the assertion below happened to run
    // in the gap before it arrived. A test that passes on a race is not
    // passing.
    const lines = detail.locator('.ant-table-wrapper').filter({ hasText: 'EPF (emp)' });
    await expect(lines.getByRole('row', { name: /Dr Aisyah Rahman/ })).toContainText('1980.00');
    await expect(lines.getByRole('row', { name: /Hafiz Osman/ })).toContainText('0.00');

    // And approving is gated on resolving them, not merely warned about.
    const approve = page.getByRole('button', { name: /Approve/ });
    if (await approve.count() > 0) await expect(approve.first()).toBeDisabled();

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
