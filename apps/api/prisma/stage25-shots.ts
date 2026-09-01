/**
 * STAGE 2.5 — THE VISUAL UAT PACK.
 *
 * Photographs the IMPLEMENTED APPLICATION, not design artboards: Payroll Home,
 * each of the six steps, the employee workspace, claims, locum sessions and
 * Payroll settings, at desktop, tablet and mobile.
 *
 *   ADMIN_UAT_PASSWORD=… npx tsx prisma/stage25-shots.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, Browser, Page } from 'playwright-core';

const WEB = process.env.SHOTS_WEB ?? 'http://localhost:5173';
const EMAIL = process.env.SHOTS_EMAIL ?? 'owner@admin-uat.kuwick.invalid';
const PASSWORD = process.env.ADMIN_UAT_PASSWORD ?? 'AdminUat!2026';
const OUT = process.env.SHOTS_DIR ?? join(process.cwd(), '..', '..', 'docs', 'payroll-stage25-uat');
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium';

const DESKTOP = { width: 1680, height: 1050 };
const TABLET = { width: 1024, height: 1366 };
const MOBILE = { width: 390, height: 844 };

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
  // The app routes client-side after a successful sign-in, so there is no
  // navigation event for `waitForURL` to hang its default `load` wait on. Ask
  // the page itself where it is instead.
  await page.waitForFunction(() => !window.location.pathname.includes('/login'), null, { timeout: 30_000 });
}

async function go(page: Page, path: string) {
  await page.goto(`${WEB}${path}`);
  await page.locator('.kw-admin').waitFor({ timeout: 30_000 });
  await settle(page);
}

/** The run id for the seeded period, read off Payroll Home's own link. */
async function currentRunId(page: Page): Promise<string | null> {
  await go(page, '/admin/hr/payroll');
  const href = await page
    .locator('a[href*="/admin/hr/payroll/"]')
    .first()
    .getAttribute('href')
    .catch(() => null);
  if (!href) return null;
  const match = href.match(/\/admin\/hr\/payroll\/([0-9a-f-]{36})/);
  return match ? match[1] : null;
}

/** The titles the API serves for each report, so the picker can be driven by key. */
function reportLabel(key: string): string {
  return (
    {
      PAYROLL_REGISTER: 'Payroll register',
      EMPLOYER_COST: 'Cost to the clinic',
      STATUTORY_TOTALS: 'Statutory totals',
      VARIANCE: 'This month against last',
      CLAIMS: 'Claims and reimbursements',
    }[key] ?? key
  );
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser: Browser = await chromium.launch({ executablePath: CHROME });

  // ---- DESKTOP -----------------------------------------------------------
  const desktop = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 1 });
  const page = await desktop.newPage();
  await signIn(page);

  await go(page, '/admin/hr/payroll');
  await capture(page, 'payroll-home', 'Payroll Home — one question, one button, three cards');

  const runId = await currentRunId(page);
  if (runId) {
    for (const step of ['employees', 'attendance', 'earnings', 'deductions', 'review', 'approve']) {
      await go(page, `/admin/hr/payroll/${runId}?step=${step}`);
      await capture(page, `run-${step}`, `Step — ${step}`);
    }

    // The earnings drill-down: where a derived figure came from.
    await go(page, `/admin/hr/payroll/${runId}?step=earnings`);
    const expander = page.locator('.ant-table-row-expand-icon').first();
    if (await expander.count()) {
      await expander.click();
      await capture(page, 'run-earnings-provenance', 'Earnings drill-down — the source behind each figure');
    }
  } else {
    console.log('  (no run for this period — journey steps skipped)');
  }

  await go(page, '/admin/hr/employees');
  await capture(page, 'employees', 'Employee list');

  // The workspace: open the first employee and photograph the tabs that carry
  // the readiness checklist, the salary periods and the claims.
  const firstRow = page.locator('.ant-table-tbody tr.ant-table-row').first();
  if (await firstRow.count()) {
    await firstRow.click();
    await page.waitForURL(/\/admin\/hr\/employees\/[0-9a-f-]{36}/, { timeout: 20_000 }).catch(() => {});
    await settle(page);
    await capture(page, 'employee-overview', 'Employee workspace — payroll readiness checklist');
    for (const tab of ['Salary', 'Claims', 'Payroll']) {
      // antd Segmented hides a radio behind the label; click the label.
      const control = page.locator('.ant-segmented-item-label').filter({ hasText: new RegExp('^' + tab + '$') });
      if (await control.count()) {
        await control.first().click();
        await capture(page, `employee-${tab.toLowerCase()}`, `Employee workspace — ${tab}`);
      }
    }
  }

  await go(page, '/admin/hr/claims');
  await capture(page, 'claims', 'Staff claims — one payment route per claim');

  await go(page, '/admin/hr/locum');
  await capture(page, 'locum', 'Locum sessions — a payable, never a payslip');

  await go(page, '/admin/hr/settings');
  await capture(page, 'payroll-settings', 'Payroll settings — the six-step setup checklist');

  // WHO IS ALLOWED TO APPROVE PAYROLL, and the honest warning when the chosen
  // rule cannot take effect. Scrolled to, because it sits below the checklist.
  const approvalHeading = page.getByText('Who can approve payroll', { exact: false }).first();
  if (await approvalHeading.count()) {
    await approvalHeading.scrollIntoViewIfNeeded();
    await settle(page);
    await capture(page, 'payroll-approval-rule', 'Payroll settings — who may approve, as a sentence not a mode name');
  }

  // THE FIVE REPORTS. Each is a view of rows the run already wrote.
  for (const [key, file, caption] of [
    ['PAYROLL_REGISTER', 'report-register', 'Report — payroll register, with the components behind each row'],
    ['EMPLOYER_COST', 'report-employer-cost', 'Report — cost to the clinic, by branch and by employer'],
    ['STATUTORY_TOTALS', 'report-statutory', 'Report — statutory totals, for checking, not a submission'],
    ['VARIANCE', 'report-variance', 'Report — this month against last, every movement a subtraction'],
    ['CLAIMS', 'report-claims', 'Report — claims and the one route each was paid by'],
  ] as const) {
    await go(page, '/admin/hr/reports');
    // BY ITS LABEL, not by position: the shell's own branch picker is the first
    // `.ant-select` on the page, so `.first()` opened that one and quietly
    // photographed the same report five times.
    await page.locator('.ant-select').filter({ has: page.locator('[aria-label="Report"]') }).first().click();
    const option = page.locator('.ant-select-item-option').filter({ hasText: reportLabel(key) }).first();
    if (await option.count()) {
      await option.click();
      await settle(page);
      await capture(page, file, caption);
    } else {
      console.log(`  (report ${key} not offered by the picker — skipped)`);
    }
  }

  await go(page, '/admin/hr/attendance');
  await capture(page, 'timesheet', 'Timesheet — where overtime is corrected');

  await page.close();
  await desktop.close();

  // ---- TABLET ------------------------------------------------------------
  const tablet = await browser.newContext({ viewport: TABLET, deviceScaleFactor: 1 });
  const tabletPage = await tablet.newPage();
  await signIn(tabletPage);
  if (runId) {
    await go(tabletPage, `/admin/hr/payroll/${runId}?step=review`);
    await capture(tabletPage, 'tablet-review', 'Tablet — Review');
  }
  await go(tabletPage, '/admin/hr/employees');
  await capture(tabletPage, 'tablet-employees', 'Tablet — employees');
  await tabletPage.close();
  await tablet.close();

  // ---- MOBILE ------------------------------------------------------------
  const mobile = await browser.newContext({ viewport: MOBILE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mobilePage = await mobile.newPage();
  await signIn(mobilePage);
  await go(mobilePage, '/admin/hr/payroll');
  await capture(mobilePage, 'mobile-home', 'Mobile — Payroll Home');
  if (runId) {
    await go(mobilePage, `/admin/hr/payroll/${runId}?step=review`);
    await capture(mobilePage, 'mobile-review', 'Mobile — Review (read and resolve, never finalise)');
  }
  await go(mobilePage, '/admin/hr/claims');
  await capture(mobilePage, 'mobile-claims', 'Mobile — claims');
  await mobilePage.close();
  await mobile.close();

  await browser.close();
  writeFileSync(join(OUT, 'MANIFEST.txt'), manifest.join('\n') + '\n');
  console.log(`\n${shot} screenshots in ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
