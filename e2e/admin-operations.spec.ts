import { expect, test } from '@playwright/test';
import { ADMIN_ACCOUNTS, collectAdminConsoleErrors, gotoAdmin, loginAdmin, statValue } from './support/admin';

/**
 * OPERATIONS — the module most able to mislead, and therefore the one with
 * the most assertions about what it refuses to claim.
 *
 * Three specific lies this guards against, each of which a clinic would act
 * on: that revenue billed under a doctor is that doctor's income; that a
 * contribution margin with no overhead in it is net profit; and that a
 * WhatsApp message a staff member was handed to send was a message the
 * patient received.
 */
test.describe('Operations', () => {
  test('billed under a doctor is never presented as the doctor income', async ({ page }) => {
    const errors = collectAdminConsoleErrors(page);
    await loginAdmin(page, ADMIN_ACCOUNTS.owner);
    await gotoAdmin(page, '/admin/operation');

    await expect(page.getByRole('heading', { name: 'Operations' })).toBeVisible();

    // The period presets the brief asks for, all four.
    for (const preset of ['Today', 'This month', 'This quarter', 'Custom']) {
      await expect(page.getByText(preset, { exact: true })).toBeVisible();
    }

    // The disclaimer is not decoration — it is the difference between a
    // productivity report and a payslip argument.
    await expect(page.getByText(/It is NOT the doctor’s income/)).toBeVisible();
    await expect(page.getByText(/includes charges .* they do not personally earn/)).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Billed under doctor/i })).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('segments are configuration, and gross profit is not called net profit', async ({ page }) => {
    const errors = collectAdminConsoleErrors(page);
    await loginAdmin(page, ADMIN_ACCOUNTS.owner);
    await gotoAdmin(page, '/admin/operation/segments');

    await expect(page.getByRole('heading', { name: 'Segment P&L' })).toBeVisible();
    await expect(page.getByText(/as configuration rather than as five hardcoded reports/i)).toBeVisible();

    // Overheads are NOT allocated, so this is contribution, and it says so.
    await expect(page.getByText(/this is a contribution figure, not net profit/i)).toBeVisible();

    // Revenue that no rule classified is shown as its own number rather than
    // spread across the segments to make them look complete.
    await expect(statValue(page, 'NOT CLASSIFIED')).toBeVisible();

    // A real margin, from real item cost — not a flat 100% that means the
    // costs were never joined.
    const margin = await statValue(page, 'MARGIN').innerText();
    expect(Number(margin.replace(/[^0-9.]/g, ''))).toBeLessThan(100);

    expect(errors).toEqual([]);
  });

  test('a programme dashboard names what it cannot measure', async ({ page }) => {
    const errors = collectAdminConsoleErrors(page);
    await loginAdmin(page, ADMIN_ACCOUNTS.owner);
    await gotoAdmin(page, '/admin/operation/programmes');

    await expect(page.getByRole('heading', { name: 'Programmes' })).toBeVisible();

    // The missing indicators are listed BY NAME. A number nobody mentions
    // looks exactly like a number nobody measured.
    await expect(page.getByText(/What this dashboard cannot tell you/i)).toBeVisible();
    await expect(page.getByText(/Clinical control rate/i)).toBeVisible();
    await expect(page.getByText(/this system will not estimate one/i)).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('prepared is not sent, and the screen never claims otherwise', async ({ page }) => {
    const errors = collectAdminConsoleErrors(page);
    await loginAdmin(page, ADMIN_ACCOUNTS.owner);
    await gotoAdmin(page, '/admin/operation/marketing');

    await expect(page.getByRole('heading', { name: 'Marketing' })).toBeVisible();

    // Kuwick has no messaging integration and does not pretend to have one.
    await expect(page.getByText(/Kuwick has no WhatsApp integration and sends nothing/i)).toBeVisible();
    await expect(page.getByText(/it never says that they did/i)).toBeVisible();

    // The two states are defined where the history is read, because "OPENED"
    // is the most tempting thing on this screen to misread as "delivered".
    await expect(page.getByText(/PREPARED means the message text was generated/i)).toBeVisible();
    await expect(page.getByText(/Neither is confirmation that the patient received anything/i)).toBeVisible();

    expect(errors).toEqual([]);
  });
});
