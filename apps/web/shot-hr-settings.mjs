/**
 * PIECE 2 — one screenshot per Settings page the structure pass touched.
 *
 * Desktop 1440px, against the synthetic admin UAT tenant. Individual files,
 * never a collage.
 *
 *   OUT=<dir> node shot-hr-settings.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173';
const OUT = process.env.OUT ?? '/tmp/hr-settings-shots';
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
  ['01-settings-landing', '/admin/hr/settings', 'tall'],
  ['02-company-statutory', '/admin/hr/settings/company'],
  ['03-payroll-items', '/admin/hr/settings/payroll-items'],
  ['04-payroll-policies', '/admin/hr/settings/payroll', 'tall'],
  ['05-attendance-leave-policies', '/admin/hr/settings/attendance-leave'],
  ['06-public-holidays', '/admin/hr/settings/public-holidays'],
  ['07-opening-balances', '/admin/hr/settings/opening-balances'],
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
