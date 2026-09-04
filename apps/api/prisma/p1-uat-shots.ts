/**
 * P1 — THE PRODUCTION PAYROLL EXPERIENCE, PHOTOGRAPHED.
 *
 * Walks the seeded UAT world through the month the way a clinic would: reads
 * the readiness screen and the blocked exception centre AS BLOCKED, then fixes
 * the blockers the legitimate way (a salary, three tax profiles — through the
 * same API the screens call), recalculates, approves, prepares and records the
 * payment, records one statutory submission — and photographs every P1
 * surface on the way, at desktop and tablet.
 *
 *   ADMIN_UAT_PASSWORD=… npx tsx prisma/p1-uat-shots.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, Browser, Page } from 'playwright-core';

const WEB = process.env.SHOTS_WEB ?? 'http://localhost:5173';
const API = process.env.SHOTS_API ?? 'http://localhost:3000';
const EMAIL = process.env.SHOTS_EMAIL ?? 'owner@admin-uat.kuwick.invalid';
const PASSWORD = process.env.ADMIN_UAT_PASSWORD ?? 'AdminUat!2026';
const OUT = process.env.SHOTS_DIR ?? join(process.cwd(), '..', '..', 'docs', 'payroll-p1-uat');
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium';

const DESKTOP = { width: 1680, height: 1050 };
const TABLET = { width: 1024, height: 1366 };

let shot = 0;
const manifest: string[] = [];

async function settle(page: Page) {
  await page.locator('.ant-spin-spinning').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(500);
}

async function capture(page: Page, name: string, note: string) {
  await settle(page);
  shot += 1;
  const file = `${String(shot).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: join(OUT, file), fullPage: true });
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
  await page.locator('.kw-admin').waitFor({ timeout: 30_000 });
  await settle(page);
}

/** Scroll a heading of an inner-scroll page into view before capturing. */
async function scrollTo(page: Page, text: string) {
  const target = page.getByText(text, { exact: false }).first();
  if (await target.count()) {
    await target.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(300);
  }
}

// ---------------------------------------------------------------------------
// The API half: the same endpoints the screens call, driven directly so the
// pack can show the month both blocked and finished.
// ---------------------------------------------------------------------------

let bearer = '';
async function api<T>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
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
    parsed = { raw: text }; // the payment listing is CSV, not JSON
  }
  return { status: res.status, body: parsed as T };
}

async function findRun(): Promise<{ id: string; period: string; status: string } | null> {
  const login = await api<{ accessToken: string }>('POST', '/auth/login', { email: EMAIL, password: PASSWORD });
  bearer = login.body.accessToken;
  const runs = await api<{ id: string; period: string; status: string }[]>('GET', '/workforce/payroll/runs?year=2026');
  return runs.body.find((row) => row.status === 'CALCULATED') ?? runs.body[0] ?? null;
}

/**
 * Finish the month the way a clinic would: record what is missing, then
 * approve, pay and file. Idempotent — a rerun against an already-finished
 * month just reports it finished.
 */
async function finishMonth(run: { id: string; period: string; status: string }): Promise<boolean> {
  const period = run.period.slice(0, 10);

  if (run.status !== 'APPROVED' && run.status !== 'PAID') {
    // What blocks it, from the run's own record.
    const exceptions = await api<{ rows: { code: string; staffId: string | null }[] }>(
      'GET',
      `/workforce/payroll/runs/${run.id}/reports/exceptions`,
    );
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
    const approval = await api('PATCH', `/workforce/payroll/runs/${run.id}/approve`, {
      acknowledgeStatutoryGap: true,
    });
    if (approval.status !== 200) {
      console.log(`  (approval refused: ${JSON.stringify(approval.body).slice(0, 200)} — approved-state shots skipped)`);
      return false;
    }
  }

  // The payment ladder in its own order: prepare, DOWNLOAD (recording payment
  // of a listing nobody has taken a copy of is refused), then the recording.
  // Each step tolerates having already happened, so a rerun converges; a
  // refusal is printed so a wrong pack is never produced silently.
  const step = async (label: string, method: string, path: string, body?: unknown) => {
    const res = await api(method, path, body);
    if (res.status >= 400 && res.status !== 409) {
      console.log(`  (${label}: ${res.status} ${JSON.stringify(res.body).slice(0, 160)})`);
    }
    return res;
  };
  await step('prepare', 'POST', `/workforce/payroll/runs/${run.id}/payment/prepare`);
  await step('download listing', 'GET', `/workforce/payroll/runs/${run.id}/payment/listing`);
  await step('record paid', 'POST', `/workforce/payroll/runs/${run.id}/payment/record-paid`, {
    // The runs list serves the period as YYYY-MM.
    paymentDate: `${period.slice(0, 7)}-28`,
    reference: 'IBG-UAT-0001',
  });
  await step('record EPF submission', 'POST', `/workforce/payroll/runs/${run.id}/statutory-outputs/epf/record-submission`, {
    submittedDate: '2026-09-01',
    reference: 'KWSP-UAT-0001',
  });
  return true;
}

/** The titles the API serves for each report, so the picker can be driven by key. */
const REPORT_LABELS: Record<string, string> = {
  PAYROLL_REGISTER: 'Payroll register',
  PCB_SUMMARY: 'Monthly tax (PCB) summary',
  YTD: 'Year to date',
  OVERTIME: 'Overtime',
  UNPAID_LEAVE: 'Unpaid leave',
  INCENTIVES: 'Incentives and bonuses',
  EXCEPTIONS: 'Exceptions and overrides',
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
    // An employee-scope report: choose the first employee — from the OPEN
    // dropdown only; the report picker's own options are still in the DOM.
    await page.locator('.ant-select').filter({ has: page.locator('[aria-label="Employee"]') }).first().click();
    const first = page
      .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')
      .first();
    if (await first.count()) await first.click();
    await settle(page);
  }
  return true;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser: Browser = await chromium.launch({ executablePath: CHROME });

  // ---- DESKTOP -----------------------------------------------------------
  const desktop = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 1 });
  const page = await desktop.newPage();
  await signIn(page);

  // 1 · Get ready — the pre-run answer to "who cannot be paid, and why".
  await go(page, '/admin/hr/payroll/readiness');
  await capture(page, 'readiness', 'Get ready — who can be paid, who cannot, and why');
  const expander = page.locator('.ant-table-row-expand-icon').first();
  if (await expander.count()) {
    await expander.click();
    await capture(page, 'readiness-checklist', 'Get ready — one employee’s checklist, blocking before advisory');
  }

  // 2 · The month, BLOCKED: the exception centre before anybody fixes anything.
  const run = await findRun();
  const runId = run?.id ?? null;
  if (run && run.status === 'CALCULATED') {
    await go(page, `/admin/hr/payroll/${run.id}?step=review`);
    await capture(page, 'exception-centre-blocked', 'Review — the exception centre while the month is still blocked');
  }

  // 3 · Fix the blockers the legitimate way and finish the month via the API.
  const approved = run ? await finishMonth(run) : false;

  if (runId) {
    await go(page, `/admin/hr/payroll/${runId}?step=earnings`);
    await capture(page, 'run-earnings', 'Earnings — server figures, LINDUNG and every column the gross contains');
    await go(page, `/admin/hr/payroll/${runId}?step=deductions`);
    await capture(page, 'run-deductions', 'Deductions — statutory beside other withholdings, nulls named');
    await go(page, `/admin/hr/payroll/${runId}?step=approve`);
    await capture(page, 'run-approved', approved ? 'Approved — the frozen record' : 'Approve step');

    if (approved) {
      await scrollTo(page, 'Payment');
      await capture(page, 'payment-panel', 'Payment — prepared, downloaded, RECORDED PAID: the honesty ladder');
      await scrollTo(page, 'Payslips');
      await capture(page, 'payslips-panel', 'Payslips — issued from the approved snapshot, never the live rows');
      await scrollTo(page, 'Statutory outputs');
      await capture(page, 'statutory-outputs', 'Statutory outputs — totals for checking, one recorded EPF filing');
    }
  }

  // 4 · The reports the month is read through.
  for (const [key, file, caption] of [
    ['PAYROLL_REGISTER', 'report-register', 'Report — the register, every column footing to gross'],
    ['PCB_SUMMARY', 'report-pcb', 'Report — monthly tax, calculated vs entered from the marker'],
    ['YTD', 'report-ytd', 'Report — the cumulative ledger, TP3 listed apart'],
    ['OVERTIME', 'report-overtime', 'Report — overtime tier by tier, naming the provision'],
    ['UNPAID_LEAVE', 'report-unpaid-leave', 'Report — absence as a wage reduction, never a deduction'],
    ['INCENTIVES', 'report-incentives', 'Report — incentives and bonuses with their provenance'],
    ['EXCEPTIONS', 'report-exceptions', 'Report — the exception record, overrides included'],
    ['PAYMENT_STATUS', 'report-payment-status', 'Report — where the money stands, in the language of evidence'],
    ['PAYROLL_HISTORY', 'report-history', 'Report — one employee across every run, corrections named'],
  ] as const) {
    if (await openReport(page, key)) await capture(page, file, caption);
  }

  // 5 · The employee record: standing, its editor, and the tax file.
  await go(page, '/admin/hr/employees');
  const firstRow = page.locator('.ant-table-tbody tr.ant-table-row').first();
  if (await firstRow.count()) {
    await firstRow.click();
    await page.waitForURL(/\/admin\/hr\/employees\/[0-9a-f-]{36}/, { timeout: 20_000 }).catch(() => {});
    await settle(page);
    const employment = page.locator('.ant-segmented-item-label').filter({ hasText: /^Employment$/ });
    if (await employment.count()) {
      await employment.first().click();
      await scrollTo(page, 'Statutory standing');
      await capture(page, 'statutory-standing', 'Statutory standing — the dated record, with its version history');
      const record = page.getByRole('button', { name: 'Record a change' }).last();
      if (await record.isVisible().catch(() => false)) {
        await record.click();
        await page.locator('.ant-modal').waitFor({ timeout: 10_000 });
        await page.waitForTimeout(400);
        shot += 1;
        const file = `${String(shot).padStart(2, '0')}-standing-editor.png`;
        await page.screenshot({ path: join(OUT, file) });
        manifest.push(`${file} — Statutory standing — recorded as a dated version, prefilled from the one in force`);
        console.log(`  ${file}`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
    }
    const taxTab = page.locator('.ant-segmented-item-label').filter({ hasText: /Tax \(TP1/ });
    if (await taxTab.count()) {
      await taxTab.first().click();
      await capture(page, 'employee-tax', 'Tax (TP1/TP3) — the month’s reliefs and previous employment, captured');
    }
  }

  // 6 · Opening balances — the remediation path the advisory points at.
  await go(page, '/admin/hr/payroll/ytd-opening');
  await capture(page, 'ytd-opening', 'Opening balances — months, not totals; TP3 money refused here');

  await page.close();
  await desktop.close();

  // ---- TABLET ------------------------------------------------------------
  const tablet = await browser.newContext({ viewport: TABLET, deviceScaleFactor: 1 });
  const tabletPage = await tablet.newPage();
  await signIn(tabletPage);
  await go(tabletPage, '/admin/hr/payroll/readiness');
  await capture(tabletPage, 'tablet-readiness', 'Tablet — Get ready');
  if (runId) {
    await go(tabletPage, `/admin/hr/payroll/${runId}?step=approve`);
    await capture(tabletPage, 'tablet-approved', 'Tablet — the approved month');
    if (approved) {
      await scrollTo(tabletPage, 'Payment');
      await capture(tabletPage, 'tablet-payment', 'Tablet — payment panel');
    }
  }
  if (await openReport(tabletPage, 'PCB_SUMMARY')) {
    await capture(tabletPage, 'tablet-report-pcb', 'Tablet — monthly tax summary');
  }
  await go(tabletPage, '/admin/hr/payroll/ytd-opening');
  await capture(tabletPage, 'tablet-ytd-opening', 'Tablet — opening balances');
  await tabletPage.close();
  await tablet.close();

  await browser.close();

  writeFileSync(
    join(OUT, 'manifest.md'),
    [
      '# P1 payroll — visual UAT pack',
      '',
      'Photographed against the seeded UAT world (`seed-admin-uat.ts`): the month is',
      'shown BLOCKED first, then the blockers are fixed through the same API the',
      'screens call, and the finished month — approved, paid, one filing recorded —',
      'is photographed the whole way through. Desktop 1680×1050, tablet 1024×1366.',
      '',
      ...manifest.map((line) => `- ${line}`),
      '',
    ].join('\n'),
  );
  console.log(`done — ${shot} screenshots in ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
