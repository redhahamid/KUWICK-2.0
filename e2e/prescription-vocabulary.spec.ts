import { expect, test } from '@playwright/test';
import { ACCOUNTS, login } from './support/app';

/**
 * b1 PHASE 1G — SETTINGS › PRESCRIPTION VOCABULARY, on the deployed shape.
 *
 * The unit tests prove this screen behaves correctly given rows. This proves
 * there ARE rows, on a real server, against a real seeded database — which is
 * the half that has failed before. "The list was empty" is exactly how the
 * diagnosis outage reached a doctor: an antd dropdown with nothing in it
 * renders silence, and silence has no symptom to report.
 *
 * So the assertions are on WORDS THE CLINIC READS. Not counts, not classes:
 * the Malay label that prints on a patient's medicine, and the sentence that
 * explains why one list cannot be added to.
 */

const VOCABULARY = '/settings/clinical/prescription-vocabulary';

test.describe('the prescribing vocabulary is loaded and visible', () => {
  test('all five catalogues render with real seeded rows', async ({ page }) => {
    await login(page, ACCOUNTS.owner);
    await page.goto(VOCABULARY);

    // 1A — the frequency, in BOTH halves. The code is what the clinic says to
    // each other; the Malay is what the patient reads off the label. A screen
    // showing only "TDS" cannot be checked by the person it is for.
    const frequencies = page.getByTestId('catalog-frequencies');
    await expect(frequencies.getByText('TDS', { exact: true })).toBeVisible();
    await expect(frequencies.getByText('Tiga kali sehari')).toBeVisible();

    // 1B–1E. Each asserted independently: five sections drawn by one component
    // is an argument for consistency, not proof that all five got data.
    await expect(page.getByTestId('catalog-dosage-units').getByText('Tablet').first()).toBeVisible();
    await expect(
      page.getByTestId('catalog-consumption-methods').getByText('ORAL (MAKAN/MINUM)'),
    ).toBeVisible();
    await expect(page.getByTestId('catalog-indications').getByText('Demam').first()).toBeVisible();
    await expect(page.getByTestId('catalog-stock-units').getByText(/PER STRIP/i).first()).toBeVisible();
  });

  test('a standard entry is locked, and says so before it is clicked', async ({ page }) => {
    await login(page, ACCOUNTS.owner);
    await page.goto(VOCABULARY);

    const row = page.getByTestId('catalog-frequencies').locator('tr', { hasText: 'TDS' }).first();
    await expect(row.getByText('Standard')).toBeVisible();
    await expect(row.getByText(/Locked/)).toBeVisible();
    // The refusal is on the screen rather than behind a click that fails.
    await expect(row.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  });

  test('stock units refuse an addition, with the reason on the page', async ({ page }) => {
    await login(page, ACCOUNTS.owner);
    await page.goto(VOCABULARY);

    const stock = page.getByTestId('catalog-stock-units');
    await expect(stock.getByRole('button', { name: /add custom/i })).toBeDisabled();
    // Readable without hovering — a tooltip does not exist on a phone.
    await expect(stock.getByText(/stock deduction arithmetic depends on it/i)).toBeVisible();
  });
});

test.describe('a medicine carries the standard prescription it was seeded with', () => {
  test("the golden path's own drug opens with its defaults filled", async ({ page }) => {
    // `seed:standard-rx` claims 2 Tablet TDS for 5 days for paracetamol. That
    // claim is worth nothing until a screen shows it: the seeder wrote FOREIGN
    // KEYS, and a key pointing at a row that is not there renders as an empty
    // box with no error anywhere.
    await login(page, ACCOUNTS.owner);
    await page.goto('/management/stock/items');

    // Through the search box, because that is the only way a person reaches
    // one medicine out of 236 on a page that shows ten at a time.
    await page.getByLabel('Search items').fill('Paracetamol 500mg');
    await page.getByLabel('Search items').press('Enter');

    const row = page.locator('tr', { hasText: 'Paracetamol 500mg' }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole('button', { name: 'Edit' }).click();

    const drawer = page.getByRole('dialog');
    await expect(drawer.getByText('Standard Prescription (default)')).toBeVisible();
    await expect(drawer.getByRole('spinbutton', { name: 'Dose amount' })).toHaveValue('2');
    // The dropdowns resolved their ids to names — which is the part that
    // silently fails if the reference catalogues were not seeded first.
    await expect(drawer.getByText('Tablet', { exact: true })).toBeVisible();
    await expect(drawer.getByText(/^TDS —/)).toBeVisible();
    await expect(drawer.getByText('ORAL (MAKAN/MINUM)')).toBeVisible();
    // By ROLE, because the legacy free-text "Duration" field is still on this
    // form until the prescribing modal is rewired, and two boxes whose labels
    // both begin "Duration" is precisely why the free-text ones now say so.
    await expect(drawer.getByRole('spinbutton', { name: 'Duration' })).toHaveValue('5');
    await expect(drawer.getByText('Days')).toBeVisible();
  });
});
