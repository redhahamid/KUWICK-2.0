import { expect, test } from '@playwright/test';
import { ACCOUNTS, login } from './support/app';

/**
 * b1.5 PHASE D — the patient profile and their alerts, on the deployed shape.
 *
 * The unit tests prove the screen behaves given data. This proves the round
 * trip: an alert recorded here is attributed to the signed-in doctor by the
 * SERVER, comes back on the list, and reaches the prescribing banner — which
 * is the half that has failed before, because the banner used to read only
 * `patient.allergies` and went on saying "Allergy not asked" forever.
 */

async function openConsult(page: import('@playwright/test').Page) {
  await login(page, ACCOUNTS.doctor);
  await page.goto('/queue');
  await page.getByRole('tab', { name: /^consultation/i }).click();
  await page.getByRole('link', { name: /Ujian/i }).first().click();
  await expect(page.getByText('Record View')).toBeVisible();

  // The identity strip belongs to the CANVAS header, and the default layout is
  // Flow — without this the band under test is not on the page at all.
  await page.evaluate(() => {
    const session = JSON.parse(window.localStorage.getItem('kuwick-auth') ?? '{}');
    const staffId = session?.state?.staff?.id;
    window.localStorage.setItem(
      'kuwick-record-view-layout-v2',
      JSON.stringify({
        state: { byStaffId: staffId ? { [staffId]: 'canvas' } : {}, anonymous: 'canvas' },
        version: 0,
      }),
    );
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Patient details', exact: true })).toBeVisible();
}

test('the identity strip opens the profile, and the profile knows the patient', async ({ page }) => {
  await openConsult(page);

  await page.getByRole('button', { name: 'Patient details', exact: true }).click();

  // The things that had no home in the consult at all.
  // Exact, because "Emergency contact phone" also ends in both words.
  await expect(page.getByLabel('Phone', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Emergency contact', { exact: true })).toBeVisible();
  await expect(page.getByTestId('patient-alerts')).toBeVisible();
});

test('an alert is recorded against the signed-in doctor, and reaches the banner', async ({ page }) => {
  await openConsult(page);
  // FIX 1 — through the ALERT CHIP, which is the control a doctor reaches for
  // mid-consult. It used to open the whole profile.
  await page.getByRole('button', { name: /patient alert/i }).click();
  // By its heading: antd does not forward data-testid to the dialog root, and
  // the heading is what a doctor reads anyway.
  await expect(page.getByText('Patient alerts')).toBeVisible();
  // And it is NOT the profile: no editable demographics behind this click.
  await expect(page.getByLabel('Phone', { exact: true })).toHaveCount(0);

  const alerts = page.getByTestId('patient-alerts');
  await expect(alerts).toBeVisible();

  // A label unique to this run, so a re-run cannot pass on an earlier one.
  const label = `E2E allergy ${Date.now().toString(36).toUpperCase().slice(-6)}`;
  await page.getByRole('button', { name: 'Add alert' }).click();
  await page.getByLabel('Alert', { exact: true }).fill(label);
  await page.getByRole('button', { name: 'Record alert' }).click();

  // ATTRIBUTED BY THE SERVER. The browser never sends an author, so this is
  // the session being resolved rather than a value echoed back.
  const row = alerts.locator('div', { hasText: label }).first();
  await expect(row).toBeVisible();
  await expect(alerts.getByText(/Recorded by /).first()).toBeVisible();

  // And the prescribing banner now says so, instead of "Allergy not asked".
  // `.last()`: the modal's own X is also labelled Close. The footer button is
  // the one a person reaches for.
  await page.getByRole('button', { name: 'Close' }).last().click();
  await expect(page.getByText(/Allergy not asked/)).toHaveCount(0);
  await expect(page.getByText(new RegExp(label)).first()).toBeVisible();
});
