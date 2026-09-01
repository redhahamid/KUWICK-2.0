/**
 * STAGE 1 + STAGE 2 — THE VISUAL UAT PACK.
 *
 * Not a route sweep. This drives the payroll workflow the way a clinic manager
 * would, in order, and photographs each state on the way through: the employer
 * that cannot file, the salary that has a history, the input that has an
 * author, the exception that refuses to be waved past, the approval that
 * writes a snapshot, the reopen that keeps the old one.
 *
 * WHY A WORKFLOW AND NOT A LIST OF URLS. Half of what Stage 2 added only
 * exists in a state you have to reach — a candidate diff needs an approval and
 * a reopen behind it, and a gate that has cleared needs the blockers actually
 * cleared. Screenshotting the routes alone would photograph the empty case and
 * call it done.
 *
 *   ADMIN_UAT_PASSWORD=… npx tsx prisma/payroll-stage12-shots.ts
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, Browser, Page } from 'playwright-core';

const WEB = process.env.SHOTS_WEB ?? 'http://localhost:5173';
const API = process.env.SHOTS_API ?? 'http://localhost:3000';
const EMAIL = process.env.SHOTS_EMAIL ?? 'owner@admin-uat.kuwick.invalid';
const PASSWORD = process.env.ADMIN_UAT_PASSWORD ?? 'AdminUat!2026';
const OUT = process.env.SHOTS_DIR ?? join(process.cwd(), '..', '..', 'docs', 'payroll-stage12-uat');
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium';

const DESKTOP = { width: 1680, height: 1050 };
const TABLET_LANDSCAPE = { width: 1194, height: 834 };
const TABLET_PORTRAIT = { width: 834, height: 1194 };
const MOBILE = { width: 390, height: 844 };

let shot = 0;
const manifest: string[] = [];

async function capture(page: Page, name: string, note: string, opts: { full?: boolean } = {}) {
  await settle(page);
  shot += 1;
  const file = `${String(shot).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: join(OUT, file), fullPage: opts.full ?? true });
  manifest.push(`${file} — ${note}`);
  console.log(`  ${file}`);
}

async function settle(page: Page) {
  await page.locator('.ant-spin-spinning').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(450);
}

/**
 * antd mounts modals and drawers in a portal, both with role="dialog", so a
 * class selector is both fragile and ambiguous. Filter by the title the user
 * can see — the same way the golden-path spec does.
 */
function dialog(page: Page, text: string | RegExp) {
  return page.getByRole('dialog').filter({ hasText: text });
}

async function signIn(page: Page) {
  await page.goto(`${WEB}/login`);
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30_000 });
}

/** Open the payroll screen with the seeded run selected. */
async function openRun(page: Page) {
  await page.goto(`${WEB}/admin/hr/payroll`);
  await page.locator('.kw-admin').waitFor({ timeout: 30_000 });
  await settle(page);
  const row = page.locator('.ant-table-tbody tr.ant-table-row').first();
  await row.click();
  await settle(page);
}

/**
 * The one thing this pack cannot do through the product: give an employee a
 * basic salary. There is no employee form in the UI — `useUpsertEmployee` is
 * defined and imported by nothing — so the blocker that stops the run being
 * approved is cleared here through the endpoint the missing form would call.
 * Recorded openly rather than quietly worked around: it is a finding, not a
 * detail of the harness.
 */
async function setSalaryViaApi(staffName: string, amount: string): Promise<void> {
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const auth = (await login.json()) as { accessToken?: string; access_token?: string };
  const token = auth.accessToken ?? auth.access_token;
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  const employees = (await (await fetch(`${API}/workforce/employees`, { headers })).json()) as {
    staffId: string;
    fullName: string;
  }[];
  const match = employees.find((e) => e.fullName.includes(staffName));
  if (!match) throw new Error(`No employee matching "${staffName}"`);

  const response = await fetch(`${API}/workforce/employees/${match.staffId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ basicSalary: amount, employmentStatus: 'ACTIVE' }),
  });
  if (!response.ok) throw new Error(`Setting the salary failed: ${response.status} ${await response.text()}`);
}

/** Choose PCB, type an amount, give a reason. Used five times, so it is one place. */
async function addPcb(page: Page, modal: ReturnType<typeof dialog>, amount: string, reason: string) {
  await modal.locator('.ant-select').first().click();
  await page.waitForTimeout(400);
  // The component list is virtualised: with sixteen components only the first
  // ten are in the DOM, and PCB — the one figure this screen exists to let
  // somebody enter — is not among them until the list is scrolled. Worth
  // noting as a finding; here it just means the harness has to scroll.
  const list = page.locator('.ant-select-dropdown .rc-virtual-list-holder').last();
  for (let i = 0; i < 6; i += 1) {
    const option = page.locator('.ant-select-item-option').filter({ hasText: 'PCB (monthly tax deduction)' });
    if (await option.count()) break;
    await list.evaluate((el) => {
      el.scrollTop += 200;
    });
    await page.waitForTimeout(250);
  }
  await page.locator('.ant-select-item-option').filter({ hasText: 'PCB (monthly tax deduction)' }).first().click();
  await page.waitForTimeout(300);
  await modal.locator('input.ant-input-number-input').fill(amount);
  await modal.getByPlaceholder(/Why this was added/i).fill(reason);
  await page.waitForTimeout(300);
}

/**
 * Enter PCB for every employee still blocked on it, recalculating between
 * each so the gate is re-derived from the rows rather than assumed.
 */
async function clearPcbBlockers(page: Page) {
  for (let i = 0; i < 8; i += 1) {
    const remaining = page.getByRole('button', { name: /Enter it now/ });
    if ((await remaining.count()) === 0) return;
    await remaining.first().click();
    const d = dialog(page, /Payroll inputs/);
    await d.waitFor({ timeout: 15_000 });
    await settle(page);
    await d.getByRole('button', { name: /Add input/ }).click();
    const m = dialog(page, /Add a payroll input/);
    await m.waitFor({ timeout: 15_000 });
    await addPcb(page, m, '95.00', 'Entered from the LHDN schedule');
    await m.getByRole('button', { name: /Save input/ }).click();
    await page.waitForTimeout(1400);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: /^Recalculate$/ }).click();
    await page.waitForTimeout(2000);
    await settle(page);
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser: Browser = await chromium.launch({ executablePath: CHROME });
  const context = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await signIn(page);

  // ================= A · LEGAL EMPLOYER ==================================
  await page.goto(`${WEB}/admin/hr/employers`);
  await page.locator('.kw-admin').waitFor({ timeout: 30_000 });
  await capture(page, 'A-employers-list', 'A · Two employers, the pay-component catalogue, and "Could it file?" answered per employer');

  // The employer that CANNOT file, because that is the state worth reviewing.
  await page.getByRole('row', { name: /Contoh Wellness/ }).getByRole('button', { name: /^Edit$/ }).click();
  const editEmployer = dialog(page, /Edit Contoh Wellness/);
  await editEmployer.waitFor({ timeout: 15_000 });
  await capture(page, 'A-employer-edit', 'A · Editing the employer that is missing its SOCSO and LHDN numbers', { full: false });
  await editEmployer.getByRole('button', { name: /Cancel/ }).click();
  await page.waitForTimeout(400);

  await page.getByRole('button', { name: /New employer/ }).click();
  const newEmployer = dialog(page, /New legal employer/);
  await newEmployer.waitFor({ timeout: 15_000 });
  await capture(page, 'A-employer-new', 'A · A new employer: every statutory identity has its own field', { full: false });
  await newEmployer.getByRole('button', { name: /Cancel/ }).click();
  await page.waitForTimeout(400);

  // ================= B · SALARY HISTORY ==================================
  await page.goto(`${WEB}/admin/hr/employees`);
  await page.locator('.kw-admin').waitFor({ timeout: 30_000 });
  await settle(page);
  await capture(page, 'B-employees-list', 'B · The employee directory, before opening a record');

  await page.getByRole('row', { name: /Nurul Hidayah/ }).first().click();
  const record = dialog(page, /Salary history/);
  await record.waitFor({ timeout: 15_000 });
  await settle(page);
  await capture(page, 'B-employee-record', 'B · The record: employment, person, pay basis, salary history, statutory — as separate facts', { full: false });

  await record.getByRole('button', { name: /Record a change/ }).click();
  const salaryModal = dialog(page, /Record a salary change/);
  await salaryModal.waitFor({ timeout: 15_000 });
  await capture(page, 'B-salary-record-change', 'B · Recording a change: amount, basis, the date it takes force, and why', { full: false });

  // A REFUSAL THE SERVER OWNS, shown in the server's own words. Backdating a
  // change to before the row currently in force would make two rows true of the
  // same month, and the refusal explains that rather than saying "Bad Request".
  await salaryModal.getByRole('textbox').first().fill('3400');
  await salaryModal.locator('.ant-picker input').fill('1 Jan 2025');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  await salaryModal.locator('textarea').fill('Backdated correction');
  await salaryModal.getByRole('button', { name: /^Record$/ }).click();
  await page.waitForTimeout(1800);
  await capture(page, 'B-salary-overlap-refused', 'B · Backdating into a period the row in force already covers, refused with the reason', { full: false });
  await salaryModal.getByRole('button', { name: /Cancel/ }).click();
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // ================= C–E · THE RUN, AS SEEDED ============================
  await openRun(page);
  await capture(page, 'CDE-run-as-calculated', 'D+E · The run: statutory notice, the gate’s own sentence, the lines, the exception centre, the variance, the snapshots');

  // The exception centre on its own, at reading size.
  const centre = page.locator('.kw-adminSection', { hasText: 'Blocking items must be resolved' }).last();
  await centre.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await capture(page, 'D-exception-centre', 'D · BLOCKING and WARNING told apart by a left rule as well as colour; a passed warning keeps its reason', { full: false });

  // The override modal, on the warning that is still standing.
  const passButton = page.getByRole('button', { name: /Pass with reason/ }).first();
  if (await passButton.count()) {
    await passButton.click();
    const passModal = dialog(page, /Pass this warning/);
    await passModal.waitFor({ timeout: 15_000 });
    await capture(page, 'D-override-modal', 'D · Passing a warning: the consequence restated, and a reason demanded before it can be passed', { full: false });
    await passModal.getByRole('button', { name: /Cancel/ }).click();
    await page.waitForTimeout(400);
  }

  // The approval confirmation, while the gate still blocks.
  await capture(page, 'E-approve-blocked', 'E · Approve is disabled by the same gate object the banner quotes');

  // ================= C · PAYROLL INPUTS ==================================
  // Reached from the exception itself — the remedy where the problem is.
  await page.getByRole('button', { name: /Enter it now/ }).first().click();
  const inputs = dialog(page, /Payroll inputs/);
  await inputs.waitFor({ timeout: 15_000 });
  await settle(page);
  await capture(page, 'C-inputs-drawer', 'C · Payroll inputs for one employee, reached from the exception that needs one', { full: false });

  await inputs.getByRole('button', { name: /Add input/ }).click();
  const addInput = dialog(page, /Add a payroll input/);
  await addInput.waitFor({ timeout: 15_000 });
  await capture(page, 'C-input-add', 'C · Adding a figure: which component, how much, recurring or one-off, and why', { full: false });

  // A REFUSED SAVE, VISIBLE. Saving with nothing chosen is answered on the
  // page — the audited competitor's equivalent button simply goes quiet.
  await addInput.getByRole('button', { name: /Save input/ }).click();
  await page.waitForTimeout(800);
  await capture(page, 'C-input-rejected', 'C · A refused save says so on the page, rather than leaving a dead button', { full: false });

  await addPcb(page, addInput, '120.00', 'Entered from the LHDN schedule by the clinic’s accountant');
  await capture(page, 'C-input-filled', 'C · PCB entered by hand, because this system does not calculate it and says so', { full: false });
  await addInput.getByRole('button', { name: /Save input/ }).click();
  await page.waitForTimeout(1500);
  await settle(page);
  await capture(page, 'C-input-saved', 'C · The saved figure with its provenance: who entered it, when, and the reason given', { full: false });

  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);

  // ================= CLEARING THE GATE ===================================
  await page.getByRole('button', { name: /^Recalculate$/ }).click();
  await page.waitForTimeout(2000);
  await settle(page);
  await clearPcbBlockers(page);

  // The one thing the product cannot do: set a basic salary. See the note on
  // `setSalaryViaApi`. Doing it turns that person's NO_SALARY blocker into a
  // PCB_MISSING one, so the loop runs again afterwards.
  await setSalaryViaApi('Wan Azman', '2400');
  await openRun(page);
  await page.getByRole('button', { name: /^Recalculate$/ }).click();
  await page.waitForTimeout(2200);
  await settle(page);
  await clearPcbBlockers(page);
  await capture(page, 'E-gate-clear', 'E · Every blocker resolved: the banner changes tone, the two warnings stay on the record, Approve becomes available');

  // ================= E · APPROVAL ========================================
  await page.getByRole('button', { name: /^Approve/ }).first().click();
  const approveModal = dialog(page, /Approve and lock this payroll/);
  await approveModal.waitFor({ timeout: 15_000 });
  await capture(page, 'E-approval-confirmation', 'E · The confirmation: employer, period, totals, blocker and warning counts, and what approving admits about the rates', { full: false });
  await approveModal.getByRole('button', { name: /^Approve/ }).click();
  await page.waitForTimeout(2800);
  await settle(page);

  // ================= F · SNAPSHOT / REOPEN / DIFF ========================
  await capture(page, 'F-approved-snapshot', 'F · Approved and locked: snapshot v1 with its hash, totals and the person who approved it');

  await page.getByRole('button', { name: /^Reopen$/ }).click();
  const reopenModal = dialog(page, /Reopen this payroll/);
  await reopenModal.waitFor({ timeout: 15_000 });
  await reopenModal.locator('textarea').fill('The accountant sent a corrected PCB figure for one employee.');
  await capture(page, 'F-reopen-reason', 'F · Reopening demands a reason, and says the previous snapshot is kept', { full: false });
  await reopenModal.getByRole('button', { name: /^Reopen$/ }).click();
  await page.waitForTimeout(2800);
  await settle(page);
  await capture(page, 'F-reopened', 'F · Reopened to CALCULATED, with snapshot v1 still standing');

  // Change one figure and recalculate, so the diff has something to show.
  await page.getByRole('button', { name: /^Inputs$/ }).first().click();
  const inputs2 = dialog(page, /Payroll inputs/);
  await inputs2.waitFor({ timeout: 15_000 });
  await settle(page);
  await inputs2.getByRole('button', { name: /Add input/ }).click();
  const m2 = dialog(page, /Add a payroll input/);
  await m2.waitFor({ timeout: 15_000 });
  await addPcb(page, m2, '185.50', 'Corrected figure from the accountant');
  await m2.getByRole('button', { name: /Save input/ }).click();
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: /^Recalculate$/ }).click();
  await page.waitForTimeout(2200);
  await settle(page);
  await capture(page, 'F-candidate-diff', 'F · What a second approval would change against snapshot v1, per employee and per figure');

  const approveAgain = page.getByRole('button', { name: /^Approve/ }).first();
  if ((await approveAgain.count()) > 0 && (await approveAgain.isEnabled())) {
    await approveAgain.click();
    const again = dialog(page, /Approve and lock this payroll/);
    await again.waitFor({ timeout: 15_000 });
    await again.getByRole('button', { name: /^Approve/ }).click();
    await page.waitForTimeout(2800);
    await settle(page);
    await capture(page, 'F-second-snapshot', 'F · Snapshot v2 beside v1: two versions, two hashes, neither overwritten');
  }

  // ================= B · THE APPROVED-PERIOD REFUSAL =====================
  await page.goto(`${WEB}/admin/hr/employees`);
  await page.locator('.kw-admin').waitFor({ timeout: 30_000 });
  await settle(page);
  await page.getByRole('row', { name: /Nurul Hidayah/ }).first().click();
  const record2 = dialog(page, /Salary history/);
  await record2.waitFor({ timeout: 15_000 });
  await settle(page);
  await record2.getByRole('button', { name: /Record a change/ }).click();
  const salary2 = dialog(page, /Record a salary change/);
  await salary2.waitFor({ timeout: 15_000 });
  await salary2.getByRole('textbox').first().fill('3600');
  // INTO THE MONTH THAT IS ALREADY APPROVED. The default is next month, which
  // the server rightly allows; the refusal worth photographing is a pay change
  // dated into a period whose payroll is settled.
  await salary2.locator('.ant-picker input').fill('1 Aug 2026');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  await salary2.getByRole('button', { name: /^Record$/ }).click();
  await page.waitForTimeout(1800);
  await capture(page, 'B-approved-period-refused', 'B · A pay change dated into an approved period is refused: what they were paid is settled', { full: false });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  await context.close();

  // ================= RESPONSIVE ==========================================
  // The payroll workflow only. A tablet is what a manager reviews on; the
  // phone is what they check a blocker on between patients.
  for (const [label, size] of [
    ['tablet-landscape', TABLET_LANDSCAPE],
    ['tablet-portrait', TABLET_PORTRAIT],
    ['mobile', MOBILE],
  ] as const) {
    const rc = await browser.newContext({ viewport: size, deviceScaleFactor: 2 });
    const rp = await rc.newPage();
    await signIn(rp);
    await openRun(rp);
    await capture(rp, `R-${label}-payroll-run`, `Responsive · The payroll run at ${size.width}×${size.height}`);
    await rp.goto(`${WEB}/admin/hr/employers`);
    await rp.locator('.kw-admin').waitFor({ timeout: 30_000 });
    await capture(rp, `R-${label}-employers`, `Responsive · Legal employers at ${size.width}×${size.height}`);
    await rc.close();
  }

  await browser.close();
  console.log(`\n${manifest.length} shots written to ${OUT}\n`);
  console.log(manifest.join('\n'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
