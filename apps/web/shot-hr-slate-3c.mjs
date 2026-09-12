/**
 * PIECE 3c — Employees and the employee record on the Slate kit, at 1440px,
 * against the synthetic admin UAT tenant. Individual files, never a collage.
 *
 *   OUT=<dir> node shot-hr-slate-3c.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173';
const OUT = process.env.OUT ?? '/tmp/hr-slate-3c';
const EMAIL = process.env.UAT_EMAIL ?? 'owner@admin-uat.kuwick.invalid';
const PASSWORD = process.env.UAT_PASSWORD ?? 'AdminUat!2026';
const WHO = process.env.UAT_EMPLOYEE ?? 'Dr Meera Kaur';
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
const shoot = async (name, height) => {
  await page.setViewportSize({ width: 1440, height });
  await page.mouse.move(2, 2);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  ${name}`);
};

await page.setViewportSize({ width: 1440, height: 1400 });
await page.goto(`${BASE}/admin/hr/employees`);
await settle();
await shoot('01-employees', 1400);

// The record: found from the list by name, as a person would.
await page.getByRole('row', { name: new RegExp(WHO) }).first().click();
await page.waitForURL(/\/admin\/hr\/employees\/[0-9a-f-]+/, { timeout: 30_000 });
await settle();
const recordUrl = new URL(page.url());
recordUrl.searchParams.set('tab', 'employment');
await page.goto(recordUrl.toString());
await settle();
await shoot('02-employee-record', 1400);

for (const [name, tab, height] of [
  ['03-employee-profile', 'profile', 1300],
  ['04-employee-statutory', 'statutory', 1500],
  ['05-employee-bank', 'bank', 900],
]) {
  recordUrl.searchParams.set('tab', tab);
  await page.goto(recordUrl.toString());
  await settle();
  await shoot(name, height);
}

await page.goto(`${BASE}/admin/hr/employees?view=benefits`);
await settle();
await shoot('06-medical-benefits', 1300);

await browser.close();
console.log(`\n6 screenshots in ${OUT}`);
