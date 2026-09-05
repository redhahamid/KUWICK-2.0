/**
 * FINAL-VALIDATION UAT — the whole journey, photographed for human review.
 *
 * Walks the seeded UAT world the way a clinic owner would: the month found
 * BLOCKED, the readiness screen naming who cannot be paid and why, the
 * blockers fixed the legitimate way (through the same API the screens call),
 * the six steps read one by one, approval, the payment honesty ladder, the
 * statutory outputs, the reports — then a REOPEN with its correction cycle,
 * because a payroll product is judged by how it behaves when the month was
 * wrong. Desktop first, then the tablet set, then one phone frame.
 *
 *   SHOTS_SET=final SHOTS_DIR=../../docs/payroll-final-uat \
 *     npx tsx prisma/final-uat-shots.ts
 *
 * SHOTS_SET=before captures the historical defective states instead (kept
 * for the before/after evidence in docs/payroll-final-uat/before).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, Browser, BrowserContext, Page } from 'playwright-core';

const WEB = process.env.SHOTS_WEB ?? 'http://localhost:5173';
const API = process.env.SHOTS_API ?? 'http://localhost:3000';
const EMAIL = process.env.SHOTS_EMAIL ?? 'owner@admin-uat.kuwick.invalid';
const PASSWORD = process.env.ADMIN_UAT_PASSWORD ?? 'AdminUat!2026';
const OUT = process.env.SHOTS_DIR ?? join(process.cwd(), '..', '..', 'docs', 'payroll-final-uat');
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium';
const SET = process.env.SHOTS_SET ?? 'final';

const DESKTOP = { width: 1680, height: 1050 };
const TABLET = { width: 1024, height: 1366 };
const PHONE = { width: 390, height: 844 };

let shot = 0;
const manifest: string[] = [];

async function settle(page: Page) {
  await page.locator('.ant-spin-spinning').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(600);
}

async function capture(page: Page, name: string, note: string, fullPage = true) {
  await settle(page);
  shot += 1;
  const file = `${String(shot).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: join(OUT, file), fullPage });
  manifest.push(`${file} — ${note}`);
  console.log(`  ${file}`);
}

async function signIn(page: Page) {
  await page.goto(`${WEB}/login`);
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForFunction(() => !window.location.pathname.includes('/login'), null, { timeout: 30_000 });
}

async function go(page: Page, path: string) {
  await page.goto(`${WEB}${path}`);
  await page.locator('.kw-admin').waitFor({ timeout: 30_000 }).catch(() => {});
  await settle(page);
}

async function scrollTo(page: Page, text: string) {
  const target = page.getByText(text, { exact: false }).first();
  if (await target.count()) {
    await target.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(300);
  }
}

// --- The API half: the same endpoints the screens call. ---------------------

let bearer = '';
async function api<T = Record<string, unknown>>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text.slice(0, 200) };
  }
  return { status: res.status, body: parsed as T };
}

async function apiSignIn() {
  const res = await api<{ accessToken: string }>('POST', '/auth/login', { email: EMAIL, password: PASSWORD });
  bearer = res.body.accessToken;
}

type RunRow = { id: string; period: string; status: string };
async function findRun(): Promise<RunRow | null> {
  const res = await api<RunRow[]>('GET', '/workforce/payroll/runs');
  return res.body[0] ?? null;
}

/** Fix what blocks the month, exactly as the exception centre tells a person to. */
async function fixBlockers(run: RunRow) {
  const exceptions = await api<{ rows: { code: string; staffId: string | null }[] }>(
    'GET',
    `/workforce/payroll/runs/${run.id}/reports/exceptions`,
  );
  const period = run.period.length === 7 ? `${run.period}-01` : run.period.slice(0, 10);
  for (const row of exceptions.body.rows) {
    if (!row.staffId) continue;
    if (row.code === 'NO_SALARY') {
      await api('POST', `/workforce/employees/${row.staffId}/salary`, {
        amount: '2800.00',
        basis: 'MONTHLY',
        effectiveFrom: period,
        reason: 'UAT — salary recorded to complete the month',
      });
    }
    if (row.code === 'PCB_MISSING') {
      await api('POST', `/workforce/employees/${row.staffId}/statutory-classification`, {
        effectiveFrom: period,
        taxResidence: 'RESIDENT',
        pcbCategory: 'CATEGORY_1',
        qualifyingChildren: 0,
        reason: 'UAT — tax profile recorded to complete the month',
      });
    }
  }
  await api('PATCH', `/workforce/payroll/runs/${run.id}/calculate`);
}

const REPORT_LABELS: Record<string, string> = {
  PAYROLL_REGISTER: 'Payroll register',
  EMPLOYER_COST: 'Cost to the clinic',
  STATUTORY: 'Statutory totals',
  PCB_SUMMARY: 'Monthly tax (PCB) summary',
  YTD: 'Year to date',
  OVERTIME: 'Overtime',
  UNPAID_LEAVE: 'Unpaid leave',
  PAYMENT_STATUS: 'Payment status',
  PAYROLL_HISTORY: 'Payroll history and corrections',
};

async function openReport(page: Page, key: string): Promise<boolean> {
  await go(page, '/admin/hr/reports');
  await page.locator('.ant-select').filter({ has: page.locator('[aria-label="Report"]') }).first().click();
  const option = page.locator('.ant-select-item-option').filter({ hasText: REPORT_LABELS[key] }).first();
  if (!(await option.count())) {
    console.log(`  (report ${key} not offered — skipped)`);
    return false;
  }
  await option.click();
  await settle(page);
  if (key === 'PAYROLL_HISTORY') {
    await page.locator('.ant-select').filter({ has: page.locator('[aria-label="Employee"]') }).first().click();
    const first = page
      .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')
      .first();
    if (await first.count()) await first.click();
    await settle(page);
  }
  return true;
}

// ---------------------------------------------------------------------------

async function beforeSet(page: Page) {
  await go(page, '/admin/hr/settings');
  await capture(page, 'settings-stale-ytd-copy', 'BEFORE — payroll settings claims the YTD import is not implemented while the screen exists');
  await go(page, '/admin/hr/payroll/ytd-opening');
  await capture(page, 'ytd-opening-import', 'BEFORE — opening balances import; blank statutory fields silently become RM0.00 on staging');
  await go(page, '/admin/hr/benefits');
  await capture(page, 'benefits-two-remainings', 'BEFORE — strip Remaining clamps across the clinic; table total sums per-account clamps');
  await go(page, '/admin/hr/payroll/all');
  await capture(page, 'legacy-payroll-stale-claims', 'BEFORE — legacy payroll page still claims PCB is not calculated and payslips do not exist');
  const run = page.locator('.ant-table-row').first();
  if (await run.count()) {
    await run.click();
    await settle(page);
    await capture(page, 'legacy-run-blue-notice', 'BEFORE — "This run is blue/default" wording from the tag-colour map');
  }
  await go(page, '/admin/hr/payroll');
  await capture(page, 'payroll-home', 'BEFORE — payroll landing; attention card fails open when the gate is unknown');
}

async function desktopWalk(page: Page): Promise<{ runId: string | null; approved: boolean }> {
  const period = (await findRun())?.period?.slice(0, 7) ?? '2026-08';

  // 1 · The landing, with the month BLOCKED.
  await go(page, `/admin/hr/payroll?period=${period}` /* the month the seed calculated */);
  await capture(page, 'home-blocked', 'Payroll landing — the month as found: blocked, with the blockers counted and named');

  // 2 · Get ready — who cannot be paid, and why.
  await go(page, `/admin/hr/payroll/readiness?period=${period}`);
  await capture(page, 'readiness-blocked', 'Get ready — who can be paid, who cannot, and exactly what to do about each');
  const expander = page.locator('.ant-table-row-expand-icon').first();
  if (await expander.count()) {
    await expander.click();
    await capture(page, 'readiness-checklist', 'Get ready — one employee’s checklist: blocking before advisory, salary withheld from ineligible eyes');
  }

  // 3 · The run, blocked: steps 1 and 5.
  const run = await findRun();
  const runId = run?.id ?? null;
  if (!run) return { runId: null, approved: false };
  await go(page, `/admin/hr/payroll/${run.id}?step=employees`);
  await capture(page, 'step1-employees-blocked', 'Step 1, blocked — who is in the month, and who cannot be paid yet');
  await go(page, `/admin/hr/payroll/${run.id}?step=review`);
  await capture(page, 'exception-centre-blocked', 'Step 5, blocked — the exception centre: severity, person, cause, consequence, remediation, deep link');

  // 4 · Fix the blockers the legitimate way; the month recalculates.
  await fixBlockers(run);

  // 5 · The six steps, readable one by one.
  await go(page, `/admin/hr/payroll/${run.id}?step=employees`);
  await capture(page, 'step1-employees', 'Step 1 — everyone in, part-months named');
  await go(page, `/admin/hr/payroll/${run.id}?step=attendance`);
  await capture(page, 'step2-attendance', 'Step 2 — attendance and overtime as the month recorded them');
  await go(page, `/admin/hr/payroll/${run.id}?step=earnings`);
  await capture(page, 'step3-earnings', 'Step 3 — earnings: server figures only, every column the gross contains');
  await go(page, `/admin/hr/payroll/${run.id}?step=deductions`);
  await capture(page, 'step4-deductions', 'Step 4 — deductions: EPF/SOCSO/EIS, LINDUNG apart, PCB with its source');
  await go(page, `/admin/hr/payroll/${run.id}?step=review`);
  await capture(page, 'step5-review-clean', 'Step 5 — review with nothing left blocking');
  await go(page, `/admin/hr/payroll/${run.id}?step=approve`);
  await capture(page, 'step6-approve', 'Step 6 — the approval, its rule named, nothing overstated');

  // 6 · Approve; the frozen record and everything issued from it.
  const approval = await api('PATCH', `/workforce/payroll/runs/${run.id}/approve`, {});
  const approved = approval.status === 200;
  if (!approved) {
    console.log(`  (approval refused: ${JSON.stringify(approval.body).slice(0, 180)})`);
    return { runId, approved };
  }
  await go(page, `/admin/hr/payroll/${run.id}?step=approve`);
  await capture(page, 'approved', 'Approved — the frozen, hashed record; the month is now a fact');

  await scrollTo(page, 'Payslips');
  await capture(page, 'payslips-panel', 'Payslips — issued only from the approved snapshot, revision named');

  // 7 · The reports.
  for (const [key, file, caption] of [
    ['PAYROLL_REGISTER', 'report-register', 'Report — the register, every column footing to the run’s own totals'],
    ['EMPLOYER_COST', 'report-employer-cost', 'Report — cost to the clinic; gross plus contributions equals employer cost, levy included'],
    ['STATUTORY', 'report-statutory', 'Report — statutory totals by scheme, nulls surviving as nulls'],
    ['PCB_SUMMARY', 'report-pcb', 'Report — monthly tax: calculated vs entered, from the marker not the wording'],
    ['YTD', 'report-ytd', 'Report — the cumulative ledger, TP3 listed apart from this employer’s months'],
    ['OVERTIME', 'report-overtime', 'Report — overtime day by day, naming the Employment Act provision that priced it'],
    ['UNPAID_LEAVE', 'report-unpaid-leave', 'Report — absence as a wage reduction, never a deduction'],
    ['PAYMENT_STATUS', 'report-payment-status', 'Report — where the money stands, in the language of evidence'],
  ] as const) {
    if (await openReport(page, key)) await capture(page, file, caption);
  }

  // 8 · REOPEN — the correction cycle, which is where payroll products lie.
  // BEFORE any payment is recorded: a PAID month refuses reopening (money
  // has left; corrections are adjustments), and this pack must not imply
  // otherwise.
  const reopened = await api('PATCH', `/workforce/payroll/runs/${run.id}/reopen`, {
    reason: 'UAT — reopened to prove the correction cycle keeps its history',
  });
  if (reopened.status >= 400) console.log(`  (reopen refused: ${JSON.stringify(reopened.body).slice(0, 160)})`);
  await go(page, `/admin/hr/payroll/${run.id}?step=review`);
  await capture(page, 'reopened-review', 'Reopened — the month back at review; the approved record still stands behind payslips and filings');
  if (await openReport(page, 'PAYROLL_REGISTER')) {
    await capture(page, 'reopened-report-banner', 'Reopened — the register says these are candidate figures while revision 1 keeps serving');
  }
  await api('PATCH', `/workforce/payroll/runs/${run.id}/calculate`);
  const reapproval = await api('PATCH', `/workforce/payroll/runs/${run.id}/approve`, {});
  if (reapproval.status >= 400) console.log(`  (re-approval refused: ${JSON.stringify(reapproval.body).slice(0, 160)})`);
  await go(page, `/admin/hr/payroll/${run.id}?step=approve`);
  await capture(page, 'reapproved-v2', 'Approved again — revision 2 beside revision 1; nothing overwritten, everything dated');

  // 8b · Payment, on the CORRECTED record: the honesty ladder end to end.
  await api('POST', `/workforce/payroll/runs/${run.id}/payment/prepare`);
  await go(page, `/admin/hr/payroll/${run.id}?step=approve`);
  await scrollTo(page, 'Payment');
  await capture(page, 'payment-generated', 'Payment — a listing EXISTS and says it is not a bank file; nothing claims to be paid');
  await api('GET', `/workforce/payroll/runs/${run.id}/payment/listing`);
  await api('POST', `/workforce/payroll/runs/${run.id}/payment/record-paid`, {
    paymentDate: `${period}-28`,
    reference: 'IBG-UAT-0001',
  });
  await go(page, `/admin/hr/payroll/${run.id}?step=approve`);
  await scrollTo(page, 'Payment');
  await capture(page, 'payment-recorded', 'Payment — RECORDED PAID, by a person, with the date and reference');

  await api('POST', `/workforce/payroll/runs/${run.id}/statutory-outputs/epf/record-submission`, {
    submittedDate: `${period}-28`,
    reference: 'KWSP-UAT-0001',
  });
  await go(page, `/admin/hr/payroll/${run.id}?step=approve`);
  await scrollTo(page, 'Statutory filings');
  await capture(page, 'statutory-outputs', 'Statutory outputs — per-scheme listings with wages; EPF recorded as filed, the rest prepared only');

  // 9 · The employee’s own record.
  await go(page, '/admin/hr/employees');
  await capture(page, 'employees', 'Employees — the directory: no salary column, by design');
  const firstRow = page.locator('.ant-table-tbody tr.ant-table-row').first();
  if (await firstRow.count()) {
    await firstRow.click();
    await page.waitForURL(/\/admin\/hr\/employees\/[0-9a-f-]{36}/, { timeout: 20_000 }).catch(() => {});
    await settle(page);
    await capture(page, 'employee-workspace', 'Employee workspace — LAST PAID reads only an approved month');
    const employment = page.locator('.ant-segmented-item-label').filter({ hasText: /^Employment$/ });
    if (await employment.count()) {
      await employment.first().click();
      await scrollTo(page, 'Statutory standing');
      await capture(page, 'statutory-standing', 'Statutory standing — the dated record and its version history');
      const record = page.getByRole('button', { name: 'Record a change' }).last();
      if (await record.isVisible().catch(() => false)) {
        await record.click();
        await page.locator('.ant-modal').waitFor({ timeout: 10_000 });
        await page.waitForTimeout(400);
        await capture(page, 'standing-editor', 'Standing editor — relief facts read “Not recorded” until somebody records them', false);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
    }
    const taxTab = page.locator('.ant-segmented-item-label').filter({ hasText: /Tax \(TP1/ });
    if (await taxTab.count()) {
      await taxTab.first().click();
      await capture(page, 'employee-tax', 'Tax (TP1/TP3) — captured with provenance, a year picker for last year’s questions');
    }
  }

  // 10 · Opening balances — blank is refused, zero is deliberate.
  await go(page, '/admin/hr/payroll/ytd-opening');
  const addButton = page.getByRole('button', { name: 'Add to the import' });
  if (await addButton.count()) {
    // Choose an employee and month so the refusal shown is the BLANKS one.
    const pick = async (placeholderText: string) => {
      await page.getByText(placeholderText, { exact: true }).last().click({ force: true });
      await page.waitForTimeout(300);
      const option = page
        .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')
        .first();
      if (await option.count()) await option.click();
      await page.waitForTimeout(200);
    };
    await pick('Choose an employee');
    await pick('Month');
    await addButton.click();
    await page.waitForTimeout(400);
  }
  await capture(page, 'ytd-opening-refuses-blanks', 'Opening balances — a blank box is not RM0.00: the blanks are named, and zero is one deliberate click');

  // 11 · Settings and employers — what is inside Kuwick and what is not.
  await go(page, '/admin/hr/settings');
  await capture(page, 'settings', 'Payroll settings — the schedules with their evidence, and what remains outside Kuwick, stated');
  await go(page, '/admin/hr/employers');
  await capture(page, 'employers', 'Legal employers — filing identities; the bank account shows presence and last four only');

  return { runId, approved };
}

async function tabletWalk(context: BrowserContext, runId: string | null) {
  const page = await context.newPage();
  await signIn(page);
  await go(page, '/admin/hr/payroll');
  await capture(page, 'tablet-home', 'Tablet — the payroll landing');
  await go(page, '/admin/hr/payroll/readiness');
  await capture(page, 'tablet-readiness', 'Tablet — Get ready');
  if (runId) {
    await go(page, `/admin/hr/payroll/${runId}?step=deductions`);
    await capture(page, 'tablet-deductions', 'Tablet — step 4, the statutory columns');
    await go(page, `/admin/hr/payroll/${runId}?step=approve`);
    await capture(page, 'tablet-approved', 'Tablet — the approved month');
    await scrollTo(page, 'Payment');
    await capture(page, 'tablet-payment', 'Tablet — the payment honesty ladder');
    await scrollTo(page, 'Statutory filings');
    await capture(page, 'tablet-outputs', 'Tablet — statutory outputs');
  }
  if (await openReport(page, 'PCB_SUMMARY')) {
    await capture(page, 'tablet-report-pcb', 'Tablet — monthly tax summary');
  }
  await page.close();
}

async function phoneGlance(context: BrowserContext) {
  const page = await context.newPage();
  await signIn(page);
  await go(page, '/admin/hr/payroll');
  await capture(page, 'phone-home', 'Phone — the landing stays readable at 390px; wide tables scroll inside their own panels');
  await page.close();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser: Browser = await chromium.launch({ executablePath: CHROME });

  if (SET === 'tail') {
    // The frames after the crash point of a partial run: numbering continues.
    shot = Number(process.env.SHOTS_START ?? '32');
    await apiSignIn();
    const desktop = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 1 });
    const page = await desktop.newPage();
    await signIn(page);
    await go(page, '/admin/hr/payroll/ytd-opening');
    const addButton = page.getByRole('button', { name: 'Add to the import' });
    if (await addButton.count()) {
      const pick = async (placeholderText: string) => {
        // Click the placeholder text itself — the simplest thing that opens
        // the right dropdown regardless of antd's internal structure.
        await page.getByText(placeholderText, { exact: true }).last().click({ force: true });
        await page.waitForTimeout(300);
        const option = page
          .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')
          .first();
        if (await option.count()) await option.click();
        await page.waitForTimeout(200);
      };
      await pick('Choose an employee');
      await pick('Month');
      await addButton.click();
      await page.waitForTimeout(400);
    }
    await capture(page, 'ytd-opening-refuses-blanks', 'Opening balances — a blank box is not RM0.00: the blanks are named, and zero is one deliberate click');
    await go(page, '/admin/hr/settings');
    await capture(page, 'settings', 'Payroll settings — the schedules with their evidence, and what remains outside Kuwick, stated');
    await go(page, '/admin/hr/employers');
    await capture(page, 'employers', 'Legal employers — filing identities; the bank account shows presence and last four only');
    await page.close();
    await desktop.close();

    const run = await findRun();
    const tablet = await browser.newContext({ viewport: TABLET, deviceScaleFactor: 1 });
    await tabletWalk(tablet, run?.id ?? null);
    await tablet.close();
    const phone = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 1 });
    await phoneGlance(phone);
    await phone.close();
    await browser.close();
    writeFileSync(join(OUT, 'manifest-tail.md'), `${manifest.map((m) => `- ${m}`).join('\n')}\n`);
    console.log(`\ntail frames → ${OUT}`);
    return;
  }

  if (SET === 'before') {
    const page = await browser.newPage({ viewport: DESKTOP });
    await signIn(page);
    await beforeSet(page);
    await browser.close();
    writeFileSync(join(OUT, 'manifest.md'), `# before shots\n\n${manifest.map((m) => `- ${m}`).join('\n')}\n`);
    console.log(`\n${shot} frames → ${OUT}`);
    return;
  }

  await apiSignIn();
  const desktop = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 1 });
  const page = await desktop.newPage();
  await signIn(page);
  const { runId } = await desktopWalk(page);
  await page.close();
  await desktop.close();

  const tablet = await browser.newContext({ viewport: TABLET, deviceScaleFactor: 1 });
  await tabletWalk(tablet, runId);
  await tablet.close();

  const phone = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 1 });
  await phoneGlance(phone);
  await phone.close();

  await browser.close();
  writeFileSync(join(OUT, 'manifest.md'), `# final-validation shots\n\n${manifest.map((m) => `- ${m}`).join('\n')}\n`);
  console.log(`\n${shot} frames → ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
