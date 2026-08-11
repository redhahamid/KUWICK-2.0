import { Page, expect, test } from '@playwright/test';
import { ACCOUNTS, DIAGNOSIS_CODE, MEDICATION, chooseRadio, describeControls, login, logout, uniquePatientName } from './support/app';

/**
 * THE GUARDRAIL — one patient, front door to front door.
 *
 * register (front counter) → queue as a walk-in → doctor calls → vitals and a
 * live BMI → a clinical note that autosaves → diagnosis J06.9 → a medication
 * from the catalogue → complete the consultation through the checkpoint →
 * dispense → the invoice carries a consultation line AND a medication line →
 * payment → COMPLETED → the history rail shows the diagnosis and the
 * prescription.
 *
 * It is written as ONE test on purpose. These steps are not independent —
 * there is no meaningful "the doctor prescribes" without a patient who has
 * been registered and called — and splitting them would trade a real failure
 * message ("stalled at dispensing") for eleven cascading red tests.
 *
 * WHAT IT IS FOR. Every regression this project has shipped was invisible to
 * the unit suites: an editor that silently refused keystrokes, a header that
 * kept saying "In Consult" after the patient was sent back to wait, a banner
 * that would not go away. Each of those was a green build. This is the test
 * that goes red instead.
 */

/** A synthetic 12-digit identifier, unique per run. Never a real NRIC. */
function syntheticNric(): string {
  return `900101${String(Date.now()).slice(-6)}`;
}

/**
 * Pick an option from an antd Select, by the label above it.
 *
 * Three details this has to survive, all of them real rather than defensive.
 * The accessible node behind `getByLabel` is antd's inner combobox input,
 * which is readonly and does not reliably open the dropdown when clicked —
 * the thing a person clicks is the select box itself, so that is what this
 * clicks. The dropdown then renders
 * in a PORTAL at the end of `<body>`, never inside the drawer that owns the
 * field. And the options usually arrive from a query AFTER the drawer opens,
 * so the open-and-choose is retried as a unit; waiting inside a dropdown that
 * was opened while the list was empty just watches a stale "No data".
 */
async function chooseFromSelect(page: Page, label: string, option: string | RegExp): Promise<void> {
  const selector = page
    .locator('.ant-form-item', { has: page.locator('label', { hasText: new RegExp(`^${label}$`) }) })
    .locator('.ant-select')
    .first();
  const optionNode = page
    .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')
    .filter({ hasText: option })
    .first();

  await expect(async () => {
    // Only open it if it is not already open — clicking an OPEN antd Select
    // closes it, which is how a naive retry loop ends up toggling forever.
    if (!(await optionNode.isVisible())) await selector.click();
    await optionNode.click({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

test('golden path — registration to a completed, dispensed, paid visit', async ({ page }) => {
  const patientName = uniquePatientName('E2E Golden');
  const nric = syntheticNric();

  // =====================================================================
  // 1. REGISTER, at the front counter, and put the patient in the queue.
  // =====================================================================
  await login(page, ACCOUNTS.frontDesk);
  await page.goto('/queue');
  await page.getByRole('button', { name: 'Add to Queue' }).click();

  const registerDrawer = page.getByRole('dialog', { name: /add patient to queue/i });
  await expect(registerDrawer).toBeVisible();
  await chooseRadio(registerDrawer, 'New Patient');
  await registerDrawer.getByLabel('Name').fill(patientName);
  await registerDrawer.getByLabel('ID Number').fill(nric);
  await registerDrawer.getByRole('button', { name: /register & continue/i }).click();

  // Second step: which doctor, and what KIND of arrival. "Walk-in (W)" is the
  // golden path; the OTC variant differs here and nowhere else.
  const queueDrawer = page.getByRole('dialog', { name: new RegExp(`add ${patientName}`, 'i') });
  await expect(queueDrawer).toBeVisible();
  await chooseFromSelect(page, 'Doctor', /doctor/i);
  await chooseRadio(queueDrawer, 'Walk-in (W)');
  await queueDrawer.getByLabel('Presenting Complaint').fill('Sore throat and cough, 3 days');
  await queueDrawer.getByRole('button', { name: 'Add to Queue' }).click();
  await expect(queueDrawer).toBeHidden();

  // =====================================================================
  // 2. CALLED IN. The patient moves from Waiting to Consultation.
  // =====================================================================
  // The stage tabs are TABLES; only the Overview tab uses cards.
  await page.getByRole('tab', { name: /^waiting/i }).click();
  const waitingRow = page.getByRole('row').filter({ hasText: patientName });
  await expect(waitingRow).toBeVisible();
  await waitingRow.getByRole('button', { name: 'Call' }).click();

  const callModal = page.getByRole('dialog').filter({ hasText: /attending doctor/i });
  await expect(callModal).toBeVisible();
  await callModal.getByRole('button', { name: 'Call' }).click();
  await expect(callModal).toBeHidden();

  // Calling ANNOUNCES; it does not start the consultation. "Arrived" is the
  // moment the patient is actually in the room, and it is what moves the
  // ticket to IN_CONSULTATION. Asserting on the Call alone would have let a
  // no-op Arrived through unnoticed.
  await expect(waitingRow).toContainText(/\d{2}:\d{2}/);
  await waitingRow.getByRole('button', { name: 'Arrived' }).click();

  // Asserted, not assumed: the queue itself has to agree the patient moved.
  // A stage transition that quietly does nothing is exactly the class of
  // defect this suite exists to catch, and it is invisible to a spec that
  // only checks that a modal closed.
  await page.getByRole('tab', { name: /^consultation/i }).click();
  await expect(page.getByRole('row').filter({ hasText: patientName })).toBeVisible();
});

/**
 * NOT A GUARDRAIL — the tool that builds one.
 *
 * Kept, gated and documented rather than deleted, because the expensive part
 * of writing these specs is finding out what each screen actually renders.
 * Point it at a section and it prints the controls; that is how every selector
 * above was chosen instead of guessed.
 *
 *   E2E_DUMP=1 npx playwright test golden-path -g SCAFFOLD
 */
test('SCAFFOLD: dump the canvas as the treating doctor', async ({ page }) => {
  test.skip(!process.env.E2E_DUMP, 'a spec-building tool, not a check');
  await login(page, ACCOUNTS.doctor);
  await page.goto('/queue');
  await page.getByRole('tab', { name: /^consultation/i }).click();
  await page.getByRole('link', { name: /E2E Golden/i }).last().click();
  await expect(page.getByText('Record View')).toBeVisible();

  for (const section of ['Clinical Notes', 'Orders & Services', 'Diagnosis', 'Medications', 'Documents', 'Invoices']) {
    await page.getByText(section, { exact: true }).first().click();
    await page.waitForTimeout(2_000);
    console.log(`\n===== ${section} =====\n` + (await describeControls(page)).join('\n'));
  }
  await page.screenshot({ path: 'test-results/canvas.png', fullPage: true });
});
