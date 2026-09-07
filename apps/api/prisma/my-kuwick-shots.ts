/**
 * MY KUWICK — the staff-facing surface, photographed on the devices it is for.
 *
 * Phone first, then iPad, then desktop, because that is the order of the
 * screens' importance: an employee clocks in on a phone in a doorway. The walk
 * fails any route that renders an error boundary or a near-empty body, so it
 * is a smoke test that happens to produce evidence.
 *
 *   npx tsx prisma/my-kuwick-shots.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, Browser, Page } from 'playwright-core';

const WEB = process.env.SHOTS_WEB ?? 'http://localhost:5173';
const EMAIL = process.env.SHOTS_EMAIL ?? 'owner@admin-uat.kuwick.invalid';
const PASSWORD = process.env.ADMIN_UAT_PASSWORD ?? 'AdminUat!2026';
const OUT = process.env.SHOTS_DIR ?? join(process.cwd(), '..', '..', 'docs', 'hr-workforce-uat');

const PHONE = { width: 390, height: 844 };
const TABLET_PORTRAIT = { width: 834, height: 1112 };
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

async function walk(page: Page, path: string, name: string, note: string) {
  await page.goto(`${WEB}${path}`);
  await settle(page);
  const body = (await page.locator('body').innerText().catch(() => '')) ?? '';
  if (/something went wrong|unexpected error|failed to fetch/i.test(body)) problems.push(`ERROR TEXT on ${path}`);
  if (body.trim().length < 60) problems.push(`NEARLY EMPTY on ${path}`);
  await capture(page, name, note);
}

const ROUTES: [string, string, string][] = [
  ['/my', 'my-home', 'My Kuwick — the home screen: clock in, today, what is waiting'],
  ['/my/schedule', 'my-schedule', 'My Kuwick — my shifts, read from the one canonical roster'],
  ['/my/attendance', 'my-attendance', 'My Kuwick — what the clock recorded, and how to ask for a fix'],
  ['/my/leave', 'my-leave', 'My Kuwick — my leave and its decisions'],
  ['/my/claims', 'my-claims', 'My Kuwick — my claims, with where the money is in plain words'],
  ['/my/payslips', 'my-payslips', 'My Kuwick — my payslips, approved months only'],
  ['/my/profile', 'my-profile', 'My Kuwick — who Kuwick thinks I am, and no salary on it'],
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser: Browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium',
  });

  for (const [viewport, label, suffix] of [
    [PHONE, 'iPhone 390×844', 'phone'],
    [TABLET_PORTRAIT, 'iPad portrait 834×1112', 'ipad'],
    [DESKTOP, 'Desktop 1440×900', 'desktop'],
  ] as const) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: suffix === 'phone', hasTouch: suffix === 'phone' });
    const page = await context.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(`${page.url()} :: ${m.text().slice(0, 160)}`);
    });
    await signIn(page);
    console.log(`\n${label}`);
    for (const [path, name, note] of ROUTES) {
      await walk(page, path, `${name}-${suffix}`, `${note} · ${label}`);
    }
    // The two drawers a member of staff actually fills in, on a phone.
    if (suffix === 'phone') {
      await page.goto(`${WEB}/my/leave`);
      await settle(page);
      await page.getByRole('button', { name: 'Request leave' }).click();
      await capture(page, 'my-leave-request-phone', 'My Kuwick — the leave request drawer on a phone');
      await page.keyboard.press('Escape');
      await page.goto(`${WEB}/my/claims`);
      await settle(page);
      await page.getByRole('button', { name: 'New claim' }).click();
      await capture(page, 'my-claim-new-phone', 'My Kuwick — the claim form, with the receipt camera button');
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
  process.exit(1);
});
