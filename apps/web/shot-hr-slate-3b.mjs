/**
 * PIECE 3b — the seven Settings pages on the Slate kit, at 1440px, against
 * the synthetic admin UAT tenant. Individual files, never a collage.
 *
 *   OUT=<dir> node shot-hr-slate-3b.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173';
const OUT = process.env.OUT ?? '/tmp/hr-slate-3b';
const EMAIL = process.env.UAT_EMAIL ?? 'owner@admin-uat.kuwick.invalid';
const PASSWORD = process.env.UAT_PASSWORD ?? 'AdminUat!2026';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await context.newPage();

await page.goto(`${BASE}/login`);
await page.getByPlaceholder('name@clinic.com').fill(EMAIL);
await page.locator('input[type="password"]').fill(PASSWORD);
await page.getByRole('button', { name: /log in/i }).click();
await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 30_000 });
await page.evaluate(() => { try { window.sessionStorage.removeItem('kuwick.selectedBranch'); } catch {} });

const settle = async () => {
  await page.waitForSelector('.kw-hubRail__item', { timeout: 30_000 }).catch(() => {});
  await page.locator('.ant-spin-spinning').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {});
  await page.mouse.move(2, 2);
  await page.waitForTimeout(900);
};

// The mockup shows a clinic that has looked at the tables. So has this one.
await page.goto(`${BASE}/admin/hr/settings/statutory`);
await settle();
const mark = page.getByRole('button', { name: 'Mark as checked' });
if (await mark.isEnabled().catch(() => false)) {
  await mark.click();
  await page.locator('.ant-message').waitFor({ timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(800);
}

const PAGES = [
  ['01-settings-landing', '/admin/hr/settings', 1500],
  ['02-statutory-rates', '/admin/hr/settings/statutory', 1340],
  ['03-payroll-items', '/admin/hr/settings/payroll-items', 1300],
  ['04-company-statutory', '/admin/hr/settings/company', 900],
  ['05-payroll-policies', '/admin/hr/settings/payroll', 1500],
  ['06-attendance-leave-policies', '/admin/hr/settings/attendance-leave', 1150],
  ['07-public-holidays', '/admin/hr/settings/public-holidays', 900],
  ['08-opening-balances', '/admin/hr/settings/opening-balances', 1500],
];
for (const [name, path, height] of PAGES) {
  await page.setViewportSize({ width: 1440, height });
  await page.goto(`${BASE}${path}`);
  await settle();
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  ${name}`);
}
await browser.close();
console.log(`\n${PAGES.length} screenshots in ${OUT}`);
