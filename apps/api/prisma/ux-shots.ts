/**
 * THE HR/PAYROLL EXPERIENCE, PHOTOGRAPHED — for the rebuild's before/after.
 *
 * Every screen the brief names, at the widths it names them. The walk fails a
 * route that renders an error boundary or a near-empty body and reports every
 * console error, so it is a smoke test that happens to produce evidence.
 *
 *   SHOTS_DIR=docs/hr-ux-rebuild/before npx tsx prisma/ux-shots.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, Browser, Page } from 'playwright-core';

const WEB = process.env.SHOTS_WEB ?? 'http://localhost:5173';
const EMAIL = process.env.SHOTS_EMAIL ?? 'owner@admin-uat.kuwick.invalid';
const PASSWORD = process.env.ADMIN_UAT_PASSWORD ?? 'DevLocal!2026';
const OUT = process.env.SHOTS_DIR ?? join(process.cwd(), '..', '..', 'docs', 'hr-ux-rebuild');

const PHONE = { width: 390, height: 844 };
const TABLET_PORTRAIT = { width: 834, height: 1112 };
const TABLET_LANDSCAPE = { width: 1024, height: 768 };
const DESKTOP = { width: 1440, height: 900 };

let shot = 0;
const manifest: string[] = [];
const problems: string[] = [];
const consoleErrors: string[] = [];

async function settle(page: Page) {
  await page.locator('.ant-spin-spinning').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(600);
}

async function signIn(page: Page) {
  await page.goto(`${WEB}/login`);
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForFunction(() => !window.location.pathname.includes('/login'), null, { timeout: 30_000 });
}

async function capture(page: Page, name: string, note: string) {
  await settle(page);
  shot += 1;
  const file = `${String(shot).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: join(OUT, file), fullPage: true });
  manifest.push(`${file} — ${note}`);
  console.log(`  ${file}`);
}

type Prepare = (page: Page) => Promise<boolean>;

/** The manager's side. Desktop, iPad landscape and iPad portrait. */
const OWNER_ROUTES: [string, string, string, Prepare?][] = [
  ['/admin/hr', 'hr-overview', 'HR Overview — is the workforce okay today, and what needs me'],
  ['/admin/hr/people', 'hr-people', 'People — the directory and payroll readiness'],
  ['/admin/hr/schedule', 'hr-schedule', 'Schedule — who is working, by branch and month'],
  ['/admin/hr/attendance', 'hr-attendance', 'Attendance — scheduled against actual'],
  ['/admin/hr/requests', 'hr-leave', 'Leave — what was asked, and what was decided'],
  ['/admin/hr/claims', 'hr-claims', 'Claims — and how each one gets paid'],
  ['/admin/hr/payroll', 'hr-payroll-home', 'Payroll — the month and whether it can start'],
  ['/admin/hr/settings', 'hr-settings', 'Settings — how pay, attendance and statutory work'],
  ['/admin/hr/incentives', 'hr-incentives', 'Doctor incentives'],
  ['/admin/hr/locum', 'hr-locum', 'Locum and contractor pay'],
  ['/admin/hr/reports', 'hr-reports', 'Payroll reports'],
];

/** The employee's side, on the device it is used on. */
const STAFF_ROUTES: [string, string, string][] = [
  ['/my', 'my-home', 'My Kuwick — home'],
  ['/my/schedule', 'my-schedule', 'My Kuwick — my shifts'],
  ['/my/attendance', 'my-attendance', 'My Kuwick — what the clock recorded'],
  ['/my/leave', 'my-leave', 'My Kuwick — my leave'],
  ['/my/claims', 'my-claims', 'My Kuwick — my claims'],
  ['/my/payslips', 'my-payslips', 'My Kuwick — my payslips'],
];

async function walk(page: Page, path: string, name: string, note: string, prepare?: Prepare) {
  await page.goto(`${WEB}${path}`);
  await settle(page);
  if (prepare) {
    const reached = await prepare(page).catch(() => false);
    if (!reached) {
      problems.push(`COULD NOT PREPARE ${path}`);
      return;
    }
    await settle(page);
  }
  const body = (await page.locator('body').innerText().catch(() => '')) ?? '';
  if (/something went wrong|unexpected error|failed to fetch/i.test(body)) problems.push(`ERROR TEXT on ${path}`);
  if (body.trim().length < 60) problems.push(`NEARLY EMPTY on ${path}`);
  await capture(page, name, note);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser: Browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium',
  });

  for (const [viewport, label, suffix] of [
    [DESKTOP, 'Desktop 1440×900', 'desktop'],
    [TABLET_LANDSCAPE, 'iPad landscape 1024×768', 'ipad-landscape'],
    [TABLET_PORTRAIT, 'iPad portrait 834×1112', 'ipad'],
    [PHONE, 'iPhone 390×844', 'phone'],
  ] as const) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      isMobile: suffix === 'phone',
      hasTouch: suffix === 'phone',
    });
    const page = await context.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(`${page.url()} :: ${m.text().slice(0, 160)}`);
    });
    await signIn(page);
    console.log(`\n${label}`);

    // The manager's screens are enterprise tables; photographing them at 390px
    // would be evidence of nothing.
    if (suffix !== 'phone') {
      for (const [path, name, note, prepare] of OWNER_ROUTES) {
        await page.evaluate(() => window.sessionStorage.removeItem('kuwick.selectedBranch'));
        await walk(page, path, `${name}-${suffix}`, `${note} · ${label}`, prepare);
      }
    }
    // My Kuwick is a phone product; the desktop rendering is worth one pass.
    if (suffix === 'phone' || suffix === 'desktop') {
      for (const [path, name, note] of STAFF_ROUTES) {
        await walk(page, path, `${name}-${suffix}`, `${note} · ${label}`);
      }
    }
    await context.close();
  }

  await browser.close();
  writeFileSync(join(OUT, 'manifest.md'), `${manifest.map((m) => `- ${m}`).join('\n')}\n`);
  console.log(`\n${shot} frames → ${OUT}`);
  if (problems.length) {
    console.log('\nSCREEN PROBLEMS:');
    for (const p of problems) console.log(`  ! ${p}`);
  }
  const noisy = [...new Set(consoleErrors)].filter((e) => !/antd:/.test(e));
  if (noisy.length) {
    console.log(`\nCONSOLE ERRORS (${noisy.length} distinct):`);
    for (const e of noisy.slice(0, 15)) console.log(`  ! ${e}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
