import { Locator, Page, expect, test } from '@playwright/test';
import { ACCOUNTS, DIAGNOSIS_CODE, MEDICATION, chooseRadio, collectConsoleErrors, describeControls, login, logout, uniquePatientName } from './support/app';

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
  await openAndPick(
    page,
    page
      .locator('.ant-form-item', { has: page.locator('label', { hasText: new RegExp(`^${label}$`) }) })
      .locator('.ant-select')
      .first(),
    option,
  );
}

/**
 * The same dance for a Select that is NOT inside a Form.Item — the canvas
 * panels label their fields with plain text, so there is no `<label>` to
 * find them by. Identified instead by the placeholder antd paints inside the
 * box, which is what a person reads too.
 */
async function chooseFromPlaceholderSelect(page: Page, placeholder: string, option: string | RegExp): Promise<void> {
  await openAndPick(page, page.locator('.ant-select').filter({ hasText: placeholder }).first(), option);
}

async function openAndPick(page: Page, selectBox: Locator, option: string | RegExp): Promise<void> {
  const optionNode = page
    .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')
    .filter({ hasText: option })
    .first();

  await expect(async () => {
    // Only open it if it is not already open — clicking an OPEN antd Select
    // closes it, which is how a naive retry loop ends up toggling forever.
    if (!(await optionNode.isVisible())) await selectBox.click();
    await optionNode.click({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

/**
 * How much of a medicine has left the shelf, read through the API with the
 * session the browser is already holding.
 *
 * Deliberately not a database query: the guardrail asserts what the
 * application says about itself, and a test that reaches past the API can
 * confirm a row the app would never have shown anybody.
 */
async function stockMovementsFor(page: Page, medication: string): Promise<number> {
  return page.evaluate(async (name: string) => {
    const auth = JSON.parse(window.localStorage.getItem('kuwick-auth') ?? '{}');
    const response = await fetch('http://localhost:3000/reports/drug-movement', {
      headers: { authorization: `Bearer ${auth?.state?.accessToken}` },
    });
    if (!response.ok) return 0;
    const rows = (await response.json()) as Array<Record<string, unknown>>;
    const list = Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? []);
    return (list as Array<Record<string, unknown>>).filter((row) =>
      String(row.itemName ?? row.name ?? '').includes(name),
    ).length;
  }, medication);
}

/**
 * Put this browser in a chosen record layout.
 *
 * Written straight into the persisted preference rather than clicked, because
 * the layout is a per-staff SETTING and not the thing under test — the same
 * reasoning as clearing the session in `logout`. The toggle ITSELF is tested,
 * separately and properly, at the bottom of this file.
 *
 * WHICH LAYOUT OWNS WHAT (this cost an afternoon by being assumed backwards):
 *   FLOW   — the default. Visits History · Record View · one panel at a time.
 *   CANVAS — the single consult screen, and the ONLY layout that renders the
 *            doctor-phase completion footer.
 */
async function useLayout(page: Page, layout: 'canvas' | 'flow'): Promise<void> {
  await page.evaluate((chosen: string) => {
    // The preference is keyed by STAFF ID; `anonymous` is only consulted when
    // nobody is signed in, so setting that alone changes nothing for a
    // logged-in doctor. Read the id out of the session the app itself stored.
    const session = JSON.parse(window.localStorage.getItem('kuwick-auth') ?? '{}');
    const staffId = session?.state?.staff?.id;
    const raw = window.localStorage.getItem('kuwick-record-view-layout-v2');
    const parsed = raw ? JSON.parse(raw) : { state: { byStaffId: {}, anonymous: chosen }, version: 0 };
    parsed.state = {
      ...parsed.state,
      anonymous: chosen,
      byStaffId: { ...(parsed.state?.byStaffId ?? {}), ...(staffId ? { [staffId]: chosen } : {}) },
    };
    window.localStorage.setItem('kuwick-record-view-layout-v2', JSON.stringify(parsed));
  }, layout);
}

/**
 * The input that sits under a plain-text caption.
 *
 * The canvas panels caption their fields with ordinary text rather than a
 * `<label for=...>`, so `getByLabel` finds nothing there — a real
 * accessibility gap, noted for A2 rather than worked around silently. Until it
 * is fixed, the honest handle is "the first input after this caption", which
 * is also how a person reads the form.
 */
function fieldUnder(page: Page, caption: string): Locator {
  return page.getByText(caption, { exact: true }).first().locator('xpath=following::input[1]');
}

/**
 * Find a patient's row under a queue stage tab, wherever it is.
 *
 * Two real properties of that screen have to be handled together. The board
 * POLLS, so a stage change can land a beat after the click; and the stage
 * tables PAGINATE at ten rows, so on a busy afternoon the patient who just
 * moved is not on page one. A spec that checks only the first page of the
 * first render reports "the patient never moved" for a clinic that is merely
 * busy — which is a false alarm, and false alarms are how a guardrail gets
 * switched off.
 */
async function expectRowInStage(page: Page, stage: string, patientName: string): Promise<void> {
  const row = page.getByRole('row').filter({ hasText: patientName });
  await expect(async () => {
    await page.getByRole('tab', { name: new RegExp(`^${stage}`, 'i') }).click();
    if (await row.isVisible()) return;
    const pages = page.locator('.ant-pagination-item');
    for (let index = await pages.count(); index > 0; index -= 1) {
      await pages.nth(index - 1).click();
      if (await row.isVisible()) return;
    }
    await expect(row).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
}

/**
 * The canvas's Record View column switches the right-hand panel. Clicking the
 * section name is what a doctor does; there is no route per section.
 */
async function section(page: Page, name: string): Promise<void> {
  await page.getByText(name, { exact: true }).first().click();
}

/**
 * An authenticated GET through the session the browser already holds — same
 * reasoning as `stockMovementsFor`: the guardrail asserts what the app says
 * about itself, never a database row the app would not have shown anybody.
 * (Arrow functions only inside `evaluate` — esbuild's `keepNames` injects a
 * `__name` helper that does not exist in the page for declarations.)
 */
async function apiGet<T>(page: Page, path: string): Promise<T | null> {
  return page.evaluate(async (p: string) => {
    const auth = JSON.parse(window.localStorage.getItem('kuwick-auth') ?? '{}');
    const response = await fetch(`http://localhost:3000${p}`, {
      headers: { authorization: `Bearer ${auth?.state?.accessToken}` },
    });
    return response.ok ? response.json() : null;
  }, path) as Promise<T | null>;
}

/** The visit's invoices, with their lines — the ledger the bill asserts on. */
interface ApiInvoiceLine {
  description: string;
  amount: string;
  sourcePrescriptionId: string | null;
  sourceConsultationVisitId?: string | null;
  cancelledAt?: string | null;
}
interface ApiInvoice {
  id: string;
  status: string;
  paidAt: string | null;
  paymentMethod: string | null;
  totalAmount: string;
  lines: ApiInvoiceLine[];
}

/**
 * Settle the bill and close the visit, from the counter. Shared by the golden
 * path and the OTC variant — deliberately AFTER each has made its own
 * assertions about what the invoice contains, because the two variants exist
 * to disagree about exactly that.
 */
async function payAndComplete(page: Page, patientName: string, visitId: string): Promise<void> {
  // Payment. CASH is the pre-selected method; the button quotes the balance.
  const collect = page.getByRole('button', { name: /^Collect RM/ });
  await expect(collect).toBeEnabled();
  await collect.click();

  // Rendered consequence first (the summary says Settled), API truth second.
  await expect(page.getByText('Settled')).toBeVisible();
  await expect(async () => {
    const invoices = await apiGet<ApiInvoice[]>(page, `/invoices?visitId=${visitId}`);
    const paid = invoices?.find((invoice) => invoice.status === 'PAID');
    expect(paid?.paidAt).toBeTruthy();
  }).toPass({ timeout: 15_000 });

  // Completion happens in Queue Management, never here (D-095).
  await page.goto('/queue');
  await expectRowInStage(page, 'payment', patientName);
  const row = page.getByRole('row').filter({ hasText: patientName });
  await row.getByRole('button', { name: `Complete visit for ${patientName}` }).click();

  const completeModal = page.getByRole('dialog').filter({ hasText: /complete this visit/i });
  await expect(completeModal).toBeVisible();
  await completeModal.getByRole('button', { name: 'Complete Visit' }).click();
  await expect(completeModal).toBeHidden();

  // The queue agrees the visit is over, and so does the visit itself.
  await expectRowInStage(page, 'completed', patientName);
  await expect(async () => {
    const visit = await apiGet<{ checkOutAt: string | null }>(page, `/visits/${visitId}`);
    expect(visit?.checkOutAt).toBeTruthy();
  }).toPass({ timeout: 15_000 });
}

test('golden path — registration through payment, completion and the history rail', async ({ page }) => {
  const patientName = uniquePatientName('E2E Golden');
  const nric = syntheticNric();
  // A1 done-criterion: ZERO console errors through a complete consult.
  // Asserted at the very end, so a noisy-but-working step still runs the
  // whole path first and the failure message lists every error at once.
  const consoleErrors = collectConsoleErrors(page);

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
  await chooseFromSelect(page, 'Doctor', /Dr UAT Doctor/i);
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
  await expectRowInStage(page, 'consultation', patientName);

  // =====================================================================
  // 3. THE DOCTOR OPENS THE CANVAS.
  // =====================================================================
  await logout(page);
  await login(page, ACCOUNTS.doctor);
  await page.goto('/queue');
  await expectRowInStage(page, 'consultation', patientName);
  await page.getByRole('link', { name: patientName }).first().click();
  await expect(page.getByText('Record View')).toBeVisible();
  await expect(page.getByRole('heading', { name: patientName })).toBeVisible();
  const visitUrl = page.url();

  // =====================================================================
  // 4. VITALS, AND A BMI THAT IS ACTUALLY DERIVED.
  // =====================================================================
  await section(page, 'Clinical Notes');
  await page.getByLabel('Weight (kg)').fill('70');
  await page.getByLabel('Height (cm)').fill('170');

  // 70kg at 1.70m is 24.2. Asserting the NUMBER, not merely that the badge
  // changed: a BMI widget that renders a plausible-looking value it did not
  // compute is worse than one that renders nothing.
  await expect(page.getByTestId('live-bmi')).toContainText('24.2');

  await page.getByLabel('Pulse').fill('82');
  await page.getByRole('button', { name: 'Save Vitals' }).click();

  // =====================================================================
  // 5. A CLINICAL NOTE THAT SURVIVES A RELOAD.
  //
  // This is D1's regression test. The editor once accepted keystrokes and
  // silently dropped them, and every unit test still passed. The only
  // assertion that would have caught it is this one: type, leave, come back.
  // =====================================================================
  const NOTE = 'Sore throat and dry cough for three days. Afebrile. Throat mildly injected.';
  const editor = page.locator('.ProseMirror, [contenteditable="true"]').first();
  await editor.click();
  await editor.pressSequentially(NOTE, { delay: 10 });
  await expect(editor).toContainText(NOTE);
  await page.getByRole('button', { name: /save clinical note/i }).click();

  await page.reload();
  await section(page, 'Clinical Notes');
  await expect(page.locator('.ProseMirror, [contenteditable="true"]').first()).toContainText(NOTE);

  // =====================================================================
  // 6. DIAGNOSIS.
  // =====================================================================
  await section(page, 'Diagnosis');
  // aria-label, not a placeholder — the control is a search combobox.
  const diagnosisSearch = page.getByLabel('Search diagnosis');
  await diagnosisSearch.click();
  await diagnosisSearch.fill(DIAGNOSIS_CODE);
  const diagnosisOption = page
    .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')
    .filter({ hasText: DIAGNOSIS_CODE })
    .first();
  await expect(diagnosisOption).toBeVisible();
  // Picking from the catalogue ADDS it — the neighbouring "Add" button is for
  // a custom diagnosis that is not in the list.
  await diagnosisOption.click();
  // `.first()` because the panel shows the added row AND the still-open
  // dropdown option; either proves the click landed, and the row is asserted
  // properly by the history-rail check at the end.
  await expect(page.getByText(`${DIAGNOSIS_CODE} — Acute upper respiratory infection`).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /remove from visit/i })).toBeVisible();

  // =====================================================================
  // 7. A MEDICATION FROM THE CATALOGUE.
  // =====================================================================
  await section(page, 'Medications');
  await chooseFromPlaceholderSelect(page, 'Search medicine', MEDICATION);
  // Plain-text labels in this panel, so the placeholder is the handle.
  await fieldUnder(page, 'Dose Amount').fill('1');
  await page.getByPlaceholder('e.g. ml, tablet').fill('tablet');
  await page.getByPlaceholder('e.g. BD').fill('TDS');
  await page.getByRole('button', { name: /add to prescription/i }).click();

  // Scoped to the PRESCRIBED list, not the page.
  //
  // The first version of this assertion looked for the medicine's name
  // anywhere on the page and passed while nothing had been prescribed at all:
  // the name it found was the select box echoing its own chosen value, and
  // the app was showing "Select a medicine and fill in dose, frequency, and
  // duration". A guardrail that can pass without the thing happening is worse
  // than no guardrail, because it is trusted.
  const prescribed = page.locator('.ant-card').filter({ hasText: 'Prescribed Medications' });
  await expect(prescribed.getByText(MEDICATION)).toBeVisible();

  console.log('visit under test:', visitUrl);
  // =====================================================================
  // 8. THE DOCTOR ENDS THEIR PART, THROUGH THE CHECKPOINT.
  //
  // In the CANVAS layout, which is the only one that renders the completion
  // footer. Everything above happens in Flow, the default.
  // =====================================================================
  await useLayout(page, 'canvas');
  await page.goto(visitUrl);

  const footer = page.locator('section[aria-label="Consultation completion"]');
  await expect(footer).toBeVisible();
  await footer.getByRole('button', { name: /complete & send/i }).click();

  // The checkpoint. It is a real gate, not a formality: it names what is still
  // outstanding and makes the doctor pass it deliberately.
  const checkpoint = page.getByRole('dialog').filter({ hasText: /before completing this consultation/i });
  await expect(checkpoint).toBeVisible();
  await checkpoint.getByRole('button', { name: /proceed & complete/i }).click();
  await expect(checkpoint).toBeHidden();

  // Not /completed/i: the refusal message "The consultation could not be
  // completed." matches that regex, and did — a 403 passed this assertion
  // for two whole phases. The success state's own heading is asserted.
  await expect(footer).toContainText('Doctor phase completed');

  // =====================================================================
  // 9. THE DISPENSARY HANDS THE MEDICINE OVER.
  //
  // Front desk, not the doctor. The stock movement is the assertion that
  // matters: a "dispensed" flag that moves no stock is a clinic that thinks
  // it has medicine it has already given away.
  // =====================================================================
  await logout(page);
  await login(page, ACCOUNTS.frontDesk);
  await page.goto('/dispensary');
  await page.getByRole('button', { name: new RegExp(patientName, 'i') }).click();

  await page.getByRole('button', { name: 'Confirm Medications Dispensed' }).click();
  const dispenseModal = page.getByRole('dialog').filter({ hasText: /dispens/i });
  await expect(dispenseModal).toBeVisible();
  await dispenseModal.getByRole('button', { name: 'Confirm Medications Dispensed' }).click();
  await expect(dispenseModal).toBeHidden();

  // The assertion that matters, made against the LEDGER rather than a label.
  // A "dispensed" flag that moved no stock is a clinic that believes it still
  // has medicine it has already handed over.
  await expect(async () => {
    const movements = await stockMovementsFor(page, MEDICATION);
    expect(movements).toBeGreaterThan(0);
  }).toPass({ timeout: 20_000 });

  // =====================================================================
  // 10. THE BILL.
  //
  // Create invoice auto-adds the consultation (an idempotent server
  // operation); the medication is added from the worklist. The assertion is
  // made against the API — BOTH lines on the invoice — because the worklist
  // once kept offering a line the server had already accepted: the add
  // succeeded, the screen never refreshed, and a retry loop clicked the same
  // button for 45 seconds. billingRefresh.test.tsx pins the refresh at the
  // hook layer; this asserts the ledger.
  // =====================================================================
  const visitId = new URL(visitUrl).searchParams.get('visitId')!;
  await page.goto(`/billing/visits/${visitId}`);
  await expect(page.getByRole('heading', { name: new RegExp(`Billing review.*${patientName}`) })).toBeVisible();
  await expect(page.getByRole('button', { name: `Add ${MEDICATION} to invoice` })).toBeVisible();

  await page.getByRole('button', { name: 'Create invoice' }).click();
  // The consultation line arrives with the invoice; its worklist entry stops
  // offering itself, and only the medication is left to add.
  await expect(page.getByRole('button', { name: `Add ${MEDICATION} to invoice` })).toBeVisible();
  await page.getByRole('button', { name: `Add ${MEDICATION} to invoice` }).click();

  // The rendered consequence of a refresh that tells the truth: nothing on
  // the worklist is offered twice.
  await expect(page.getByRole('button', { name: /add .* to invoice/i })).toHaveCount(0);

  // The ledger: one invoice, carrying a consultation line AND the medication
  // line, both alive.
  const invoices = await apiGet<ApiInvoice[]>(page, `/invoices?visitId=${visitId}`);
  expect(invoices?.length).toBe(1);
  const liveLines = invoices![0].lines.filter((line) => !line.cancelledAt);
  expect(liveLines.some((line) => Boolean(line.sourceConsultationVisitId))).toBe(true);
  expect(liveLines.some((line) => Boolean(line.sourcePrescriptionId) && line.description.includes(MEDICATION))).toBe(true);

  // =====================================================================
  // 11. PAYMENT, THEN COMPLETION — and the history rail remembers.
  // =====================================================================
  await payAndComplete(page, patientName, visitId);

  // The history rail: the doctor reopens the record and the visit card says
  // what happened — completed, with the diagnosis and the prescription. This
  // is the whole consultation, readable at a glance, which is what the rail
  // is for.
  await logout(page);
  await login(page, ACCOUNTS.doctor);
  await useLayout(page, 'canvas');
  await page.goto(visitUrl);
  const todayCard = page.getByTestId('canvas-visit-today');
  await expect(todayCard).toContainText('COMPLETED');
  await expect(todayCard).toContainText(DIAGNOSIS_CODE);
  await expect(todayCard).toContainText('Paracetamol');

  // =====================================================================
  // 12. AND NOT ONE CONSOLE ERROR ALONG THE WAY.
  //
  // A1's done-criterion for the whole workstream. Asserted last so a red
  // here arrives with the complete list, after the path itself has proven
  // the app works — an error console on a working screen is still a defect,
  // just a quieter one.
  // =====================================================================
  expect(consoleErrors).toEqual([]);
});

/**
 * THE OTC (C) VARIANT — a counter sale, and the bill it must NOT carry.
 *
 * The same front door and the same worklist, entered from the other
 * direction: an OTC-queued visit classifies as OTC_ONLY, so the consultation
 * is NOT chargeable — ensure-consultation adds nothing, the page says so in
 * words, and the settled invoice carries the medication line alone. This
 * re-tests the worklist's outstanding-lines logic from the side where the
 * right answer is "nothing to add but the medicine".
 */
test('OTC (C) variant — the invoice carries the medication and NO consultation line', async ({ page }) => {
  const patientName = uniquePatientName('E2E OTC');
  const nric = syntheticNric();
  const consoleErrors = collectConsoleErrors(page);

  // Register and queue as OTC (C) — the only step that differs.
  await login(page, ACCOUNTS.frontDesk);
  await page.goto('/queue');
  await page.getByRole('button', { name: 'Add to Queue' }).click();
  const registerDrawer = page.getByRole('dialog', { name: /add patient to queue/i });
  await expect(registerDrawer).toBeVisible();
  await chooseRadio(registerDrawer, 'New Patient');
  await registerDrawer.getByLabel('Name').fill(patientName);
  await registerDrawer.getByLabel('ID Number').fill(nric);
  await registerDrawer.getByRole('button', { name: /register & continue/i }).click();

  const queueDrawer = page.getByRole('dialog', { name: new RegExp(`add ${patientName}`, 'i') });
  await expect(queueDrawer).toBeVisible();
  await chooseFromSelect(page, 'Doctor', /Dr UAT Doctor/i);
  await chooseRadio(queueDrawer, 'OTC (C)');
  await queueDrawer.getByLabel('Presenting Complaint').fill('OTC purchase — paracetamol');
  await queueDrawer.getByRole('button', { name: 'Add to Queue' }).click();
  await expect(queueDrawer).toBeHidden();

  // Called in, arrived — the ticket lifecycle is the same lifecycle.
  await page.getByRole('tab', { name: /^waiting/i }).click();
  const waitingRow = page.getByRole('row').filter({ hasText: patientName });
  await expect(waitingRow).toBeVisible();
  await waitingRow.getByRole('button', { name: 'Call' }).click();
  const callModal = page.getByRole('dialog').filter({ hasText: /attending doctor/i });
  await expect(callModal).toBeVisible();
  await callModal.getByRole('button', { name: 'Call' }).click();
  await expect(callModal).toBeHidden();
  await waitingRow.getByRole('button', { name: 'Arrived' }).click();
  await expectRowInStage(page, 'consultation', patientName);

  // The medication — and nothing else. No vitals, no note, no diagnosis:
  // the checkpoint will name those gaps and the doctor passes it knowingly.
  await logout(page);
  await login(page, ACCOUNTS.doctor);
  await page.goto('/queue');
  await expectRowInStage(page, 'consultation', patientName);
  await page.getByRole('link', { name: patientName }).first().click();
  await expect(page.getByText('Record View')).toBeVisible();
  const visitUrl = page.url();
  const visitId = new URL(visitUrl).searchParams.get('visitId')!;

  await section(page, 'Medications');
  await chooseFromPlaceholderSelect(page, 'Search medicine', MEDICATION);
  await fieldUnder(page, 'Dose Amount').fill('1');
  await page.getByPlaceholder('e.g. ml, tablet').fill('tablet');
  await page.getByPlaceholder('e.g. BD').fill('PRN');
  await page.getByRole('button', { name: /add to prescription/i }).click();
  const prescribed = page.locator('.ant-card').filter({ hasText: 'Prescribed Medications' });
  await expect(prescribed.getByText(MEDICATION)).toBeVisible();

  await useLayout(page, 'canvas');
  await page.goto(visitUrl);
  const footer = page.locator('section[aria-label="Consultation completion"]');
  await expect(footer).toBeVisible();
  await footer.getByRole('button', { name: /complete & send/i }).click();
  const checkpoint = page.getByRole('dialog').filter({ hasText: /before completing this consultation/i });
  await expect(checkpoint).toBeVisible();
  await checkpoint.getByRole('button', { name: /proceed & complete/i }).click();
  await expect(checkpoint).toBeHidden();
  // Not /completed/i: the refusal message "The consultation could not be
  // completed." matches that regex, and did — a 403 passed this assertion
  // for two whole phases. The success state's own heading is asserted.
  await expect(footer).toContainText('Doctor phase completed');

  // Dispense at the counter.
  await logout(page);
  await login(page, ACCOUNTS.frontDesk);
  await page.goto('/dispensary');
  await page.getByRole('button', { name: new RegExp(patientName, 'i') }).click();
  await page.getByRole('button', { name: 'Confirm Medications Dispensed' }).click();
  const dispenseModal = page.getByRole('dialog').filter({ hasText: /dispens/i });
  await expect(dispenseModal).toBeVisible();
  await dispenseModal.getByRole('button', { name: 'Confirm Medications Dispensed' }).click();
  await expect(dispenseModal).toBeHidden();

  // The bill. The page SAYS the consultation is not chargeable, the worklist
  // never offers it, and after the one add there is nothing left to offer.
  await page.goto(`/billing/visits/${visitId}`);
  await expect(page.getByRole('heading', { name: new RegExp(`Billing review.*${patientName}`) })).toBeVisible();
  await page.getByRole('button', { name: 'Create invoice' }).click();
  // The same sentence appears on the worklist row's state tag too, so the
  // assertion is scoped to the page-level alert.
  await expect(page.getByRole('alert').getByText('This kind of visit carries no consultation charge.')).toBeVisible();

  await page.getByRole('button', { name: `Add ${MEDICATION} to invoice` }).click();
  await expect(page.getByRole('button', { name: /add .* to invoice/i })).toHaveCount(0);

  // The ledger — the assertion this variant exists for: the medication line,
  // and NO consultation line.
  const invoices = await apiGet<ApiInvoice[]>(page, `/invoices?visitId=${visitId}`);
  expect(invoices?.length).toBe(1);
  const liveLines = invoices![0].lines.filter((line) => !line.cancelledAt);
  expect(liveLines.some((line) => Boolean(line.sourcePrescriptionId) && line.description.includes(MEDICATION))).toBe(true);
  expect(liveLines.some((line) => Boolean(line.sourceConsultationVisitId))).toBe(false);

  await payAndComplete(page, patientName, visitId);

  // A1 done-criterion, same as the main path: not one console error.
  expect(consoleErrors).toEqual([]);
});

/**
 * The layout toggle changes what RENDERS — not just what looks selected.
 *
 * This test exists because of a mistake it would have prevented. Building the
 * golden path, I read the three-column "Visits History · Record View" screen
 * as Canvas when it is in fact FLOW, went looking for the completion footer in
 * the wrong layout, and concluded from two failed attempts to "switch to Flow"
 * — a layout the browser was already in — that the toggle was broken. It was
 * not. The class said selected, and the class was telling the truth.
 *
 * So this asserts on rendered CONTENT, in both directions: the Flow layout has
 * the Record View column and no completion footer; the Canvas layout is the
 * other way round. A toggle test that asserted the selected class would have
 * passed throughout the confusion and taught me nothing.
 */
test('the layout toggle changes the rendered layout, in both directions', async ({ page }) => {
  await login(page, ACCOUNTS.doctor);
  await page.goto('/queue');
  await expectRowInStage(page, 'consultation', 'Ujian');
  await page.getByRole('link', { name: /Ujian/i }).first().click();

  const recordView = page.getByText('Record View', { exact: true });
  const footer = page.locator('section[aria-label="Consultation completion"]');
  const toggle = (name: 'Canvas' | 'Flow') => page.locator('.ant-segmented-item').filter({ hasText: name });

  // Flow is the default, and it is the one WITHOUT the completion footer.
  await expect(recordView).toBeVisible();
  await expect(footer).toBeHidden();

  await toggle('Canvas').click();
  await expect(footer).toBeVisible();
  await expect(recordView).toBeHidden();

  await toggle('Flow').click();
  await expect(recordView).toBeVisible();
  await expect(footer).toBeHidden();
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

  for (const section of (process.env.E2E_DUMP_SECTIONS ?? 'Medications').split('|')) {
    await page.getByText(section, { exact: true }).first().click();
    await page.waitForTimeout(2_000);
    console.log(`\n===== ${section} =====\n` + (await describeControls(page)).join('\n'));
    console.log('--- panel html ---');
    console.log((await page.locator('.ant-card').last().innerHTML()).replace(/class="[^"]*"/g, '').slice(0, 2500));
  }
  await page.screenshot({ path: 'test-results/canvas.png', fullPage: true });
});
