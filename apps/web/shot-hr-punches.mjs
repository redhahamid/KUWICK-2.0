import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * PIECE 1 SCREENSHOTS — a day with four punches, and the Fix drawer that can
 * express one.
 *
 *   OUT=docs/screenshots/hr-punches node apps/web/shot-hr-punches.mjs
 */
const BASE = process.env.BASE ?? 'http://127.0.0.1:5173';
const OUT = process.env.OUT ?? '/tmp/hr-punches';
const EMAIL = process.env.UAT_EMAIL ?? 'owner@admin-uat.kuwick.invalid';
const PASSWORD = process.env.UAT_PASSWORD ?? 'AdminUat!2026';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(`${BASE}/login`);
await page.getByPlaceholder('name@clinic.com').fill(EMAIL);
await page.locator('input[type="password"]').fill(PASSWORD);
await page.getByRole('button', { name: /log in/i }).click();
await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 30_000 });

const settle = async () => {
  await page.locator('.kw-admin__title').first().waitFor({ timeout: 30_000 });
  await page.locator('.ant-spin-spinning').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1800);
  await page.mouse.move(2, 2);
};

// 01 — the day sheet, with each pair and the gap between them.
await page.goto(`${BASE}/admin/hr/attendance`);
await settle();
// A branch must be chosen for the roster half of the sheet to appear.
await page.getByRole('button', { name: /Contoh Central/i }).first().click().catch(() => {});
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/01-timesheet-punches.png` });
console.log('01 timesheet');

// 02 — the Fix drawer on a four-punch day.
const fix = page.getByRole('button', { name: /^Fix$/ }).first();
await fix.click();
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/02-fix-drawer.png` });
console.log('02 fix drawer');

// 03 — a punch marked wrong: struck through, and the preview says incomplete.
const wrong = page.getByRole('button', { name: 'Wrong' });
const count = await wrong.count();
if (count >= 2) {
  await wrong.nth(1).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/03-marked-wrong.png` });
  console.log('03 marked wrong');
}

// 04 — the monthly summary, where every figure now opens the days behind it.
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
await page.getByRole('tab', { name: /Monthly summary/i }).click();
await page.waitForTimeout(1800);
await page.screenshot({ path: `${OUT}/04-monthly-summary.png` });
console.log('04 monthly summary');

if (errors.length) console.log('console errors:', errors.slice(0, 6));
await browser.close();
