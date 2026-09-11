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
    await gotoAdmin(page, '/admin/hr/today');

    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();

    // Somebody is actually on the floor, and the roster is read from the
    // canonical provider roster rather than a second HR-only schedule.
    await expect(statValue(page, 'ON DUTY NOW')).not.toHaveText('0');
    await expect(page.getByText(/Read from the provider roster/i)).toBeVisible();
    await expect(page.getByText(/changing a shift happens there, not here/i)).toBeVisible();

    /*
     * WHAT NEEDS ATTENTION IS NAMED, not counted.
     *
     * This asserted three exception TILES by label. The tiles are gone: twelve
     * counters at the top of a screen told a manager they had work and nothing
     * about whose it was. Needs Attention is a list of named rows now, and a
     * clean clinic gets one sentence rather than a row of zeroes — so what is
     * pinned here is the guarantee (every outstanding item is named and opens
     * the work), not a fixed set of labels.
     */
    const attention = page.locator('.kw-panel', { hasText: 'Needs attention' });
    await expect(attention).toBeVisible();
    const rows = attention.locator('.kw-panelRow');
    const count = await rows.count();
    if (count === 0) {
      await expect(attention).toContainText(/Nothing is waiting on you/i);
    } else {
      for (let index = 0; index < count; index += 1) {
        // A row that names work and goes nowhere is the failure this replaced.
        await expect(rows.nth(index)).toHaveAttribute('href', /\/admin\/hr\//);
      }
    }

    expect(errors).toEqual([]);
  });

  test('account, employment and clinical credential stay three separate facts', async ({ page }) => {
    const errors = collectAdminConsoleErrors(page);
    await loginAdmin(page, ADMIN_ACCOUNTS.owner);
    await gotoAdmin(page, '/admin/hr/employees');

    await expect(page.getByRole('heading', { name: 'Employees', exact: true })).toBeVisible();

    /*
     * THE DISTINCTION IS SHOWN, NOT EXPLAINED.
     *
     * This asserted the subtitle "account, employment and clinical credential
     * are three separate facts about one person" — which was accurate, and was
     * the schema describing itself to somebody who came here to look up a
     * receptionist's phone number. The sentence is gone; the guarantee is not,
     * and the two assertions below are what it actually amounts to.
     *
     * A doctor is an employee AND a credentialed clinician; a stock controller
     * is an employee and not a clinician. Collapsing those is how a clinic ends
     * up letting the wrong person sign a prescription.
     */
    await expect(page.getByRole('row', { name: /Dr Aisyah Rahman/ })).toContainText(/may sign/);
    await expect(page.getByRole('row', { name: /Hafiz Osman/ })).toContainText(/Not a clinician/);

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

    /*
     * TWO COLUMNS, DELIBERATELY — and they are the sheet's now, not the
     * summary's.
     *
     * The summary strip carries the reference sheet's five figures (scheduled,
     * present, late, missing punch, OT pending), so approved overtime moved to
     * where it is compared with the pending hours: the per-person row. The
     * guarantee is unchanged — approved and unapproved overtime are never one
     * number — and this pins it where it now lives.
     */
    await expect(statValue(page, 'OT PENDING')).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'OT approved' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'OT pending' })).toBeVisible();
    await expect(page.getByText(/A long day is not automatically overtime/i)).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('payroll is honest in both directions: computed where it can be, blocked where it cannot', async ({ page }) => {
    const errors = collectAdminConsoleErrors(page);
    await loginAdmin(page, ADMIN_ACCOUNTS.owner);
    /*
     * THE PERIOD IS EXPLICIT NOW. `/admin/hr/payroll` opens on the CURRENT
     * month — which for a clinic that has not started it is an honest
     * not-started screen, asserted separately below. The seeded month this
     * test is about is August 2026, and a test that relied on "today happens
     * to be the seeded month" was a test with a shelf life.
     */
    await gotoAdmin(page, '/admin/hr/payroll?period=2026-08');

    await expect(page.getByRole('heading', { name: 'Payroll', exact: true })).toBeVisible();
    // The month IS the landing screen — no dashboard between an owner and it.
    await expect(page.locator('.kw-payMonth')).toBeVisible();
    await expect(page.locator('.kw-payrollGrid')).toBeVisible();

    // The month in progress reads as a status, not a promise: Calculated. An
    // approved run on unchecked rates would read Provisional here instead of a
    // plain green Approved — that substitution is the row-level admission.
    //
    // A chip rather than an antd tag, and sentence case rather than the enum:
    // HR speaks one status vocabulary now (see components/Chip.tsx), and a
    // screen that prints CALCULATED is talking to the database.
    await expect(page.locator('.kw-chip', { hasText: 'Calculated' }).first()).toBeVisible();

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

    /*
     * THE MONTH IS ALREADY OPEN. `/admin/hr/payroll` used to be a landing
     * dashboard whose recent-runs table carried a link to the month; the
     * register is now the landing itself, so the way to Review is the stage
     * bar rather than a link that has to be found by the shape of its id.
     */
    // The stage's accessible name carries its hint too ("Review · Needs
    // attention"), so it is matched by the stage rather than by exact text.
    await page.locator('.kw-stage', { hasText: 'Review' }).first().click();
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

    /*
     * The month's own totals are real computed figures beside the blockers —
     * net pay and employer cost, not zeroes behind an honest-looking banner.
     *
     * The labels are the ones the month header uses, because Review, Approve
     * and the header now read the SAME five server totals; they used to be
     * "TAKE-HOME PAY" and "TOTAL COST TO THE CLINIC" here and something else
     * two screens away.
     */
    const summary = page.locator('.kw-summaryRows');
    await expect(summary.getByText('Net pay', { exact: true })).toBeVisible();
    await expect(summary.getByText('Cost to the clinic', { exact: true })).toBeVisible();
    // And the figure beside net pay is the month's, not a zero.
    await expect(summary).toContainText(/RM[\d,]+\.\d\d/);

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
