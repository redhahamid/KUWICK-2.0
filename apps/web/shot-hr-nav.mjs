/**
 * PIECE 1 — one screenshot per page the navigation pass touched.
 *
 * Desktop 1440px, against the synthetic admin UAT tenant. Individual files,
 * never a collage.
 *
 *   OUT=<dir> node shot-hr-nav.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173';
const OUT = process.env.OUT ?? '/tmp/hr-nav-shots';
const EMAIL = process.env.UAT_EMAIL ?? 'owner@admin-uat.kuwick.invalid';
const PASSWORD = process.env.UAT_PASSWORD ?? 'AdminUat!2026';

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await context.newPage();

await page.goto(`${BASE}/login`);
const slug = page.locator('input[autocomplete="organization"]');
if (await slug.isVisible().catch(() => false)) await slug.fill('admin-uat');
await page.getByPlaceholder('name@clinic.com').fill(EMAIL);
await page.locator('input[type="password"]').fill(PASSWORD);
await page.getByRole('button', { name: /log in/i }).click();
await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 30_000 });
// Every shot in the pack reads "All branches" unless a screen needs otherwise.
const allBranches = () =>
  page.evaluate(() => {
    try {
      window.sessionStorage.removeItem('kuwick.selectedBranch');
    } catch {
      /* private mode */
    }
  });
await allBranches();

const PAGES = [
  ['01-employees', '/admin/hr/employees'],
  ['02-payroll', '/admin/hr/payroll?period=2026-08'],
  ['03-attendance', '/admin/hr/attendance'],
  ['04-attendance-roster', '/admin/hr/attendance/roster'],
  ['05-leave', '/admin/hr/leave'],
  ['06-claims', '/admin/hr/claims'],
  ['07-reports', '/admin/hr/reports'],
  ['08-settings', '/admin/hr/settings', 'tall'],
  ['09-settings-company', '/admin/hr/settings/company'],
  ['10-settings-payroll-items', '/admin/hr/settings/payroll-items'],
  ['11-settings-payroll-policies', '/admin/hr/settings/payroll'],
  ['12-settings-attendance-leave', '/admin/hr/settings/attendance-leave'],
  ['13-settings-public-holidays', '/admin/hr/settings/public-holidays'],
  ['14-settings-opening-balances', '/admin/hr/settings/opening-balances'],
  ['15-today-off-rail', '/admin/hr/today'],
  // THE OTHER HALF OF THAT FIX. `/admin/hr/today` used to render under
  // Operation's chrome, so this pack has to show that Operation's own Overview
  // is still Operation's own Overview — clinic performance, not an HR screen
  // wearing the wrong tabs.
  ['16-operation-overview', '/admin/operation'],
];

for (const [name, path, mode] of PAGES) {
  // The Admin frame scrolls its own content area rather than the document, so
  // `fullPage` captures the viewport and nothing more. A taller window is the
  // honest way to show a page whose point is below the fold.
  await page.setViewportSize({ width: 1440, height: mode === 'tall' ? 1500 : 900 });
  await page.goto(`${BASE}${path}`);
  await page.waitForSelector('.kw-hubRail__item', { timeout: 30_000 }).catch(() => {});
  await page.locator('.ant-spin-spinning').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {});
  // A roster belongs to ONE branch, so the board asks which before it draws.
  // The pack should show the board, not the question. The choice is written to
  // session storage, so it is cleared again below — otherwise every later shot
  // in the pack is scoped to one branch and the headline figures disagree with
  // the rest of the pack.
  if (name.includes('roster')) {
    const branch = page.getByRole('button', { name: /Contoh/ }).first();
    if (await branch.isVisible().catch(() => false)) {
      await branch.click();
      await page.locator('.ant-spin-spinning').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {});
    }
  }
  await page.mouse.move(2, 2);
  await page.waitForTimeout(1100);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  if (name.includes('roster')) await allBranches();
  console.log(`  ${name}`);
}

await browser.close();
console.log(`\n${PAGES.length} screenshots in ${OUT}`);
