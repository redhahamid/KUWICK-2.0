import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * PIECE 2 SCREENSHOTS — the statutory treatment of a component, as something
 * the clinic decided rather than something Kuwick shipped.
 *
 *   OUT=docs/screenshots/hr-components node apps/web/shot-hr-components.mjs
 */
const BASE = process.env.BASE ?? 'http://127.0.0.1:5173';
const OUT = process.env.OUT ?? '/tmp/hr-components';
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
  await page.waitForTimeout(1600);
  await page.mouse.move(2, 2);
};

// 01 — the catalogue, with the rows this clinic decided marked as its own.
await page.goto(`${BASE}/admin/hr/settings/payroll-items`);
await settle();
await page.screenshot({ path: `${OUT}/01-payroll-items.png` });
console.log('01 payroll items');

// 02 — a system preset's switch, which used to be drawn disabled, asking when
// and why before it will save.
const allowanceSwitch = page.getByLabel('EPF for Allowance');
await allowanceSwitch.click();
await page.waitForTimeout(1000);
await page.screenshot({ path: `${OUT}/02-when-and-why.png` });
console.log('02 when and why');
await page.getByRole('button', { name: /^Cancel$/ }).first().click().catch(() => {});
await page.waitForTimeout(600);

// 03 — every version of one component, and whose decision each was.
await page.locator('tr', { hasText: 'Mileage' }).getByRole('button', { name: 'History' }).first().click();
await page.waitForTimeout(1400);
await page.screenshot({ path: `${OUT}/03-history.png` });
console.log('03 history');
await page.keyboard.press('Escape').catch(() => {});
await page.locator('.hr-drawer').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
await page.waitForTimeout(600);

// 04 — a component the clinic makes itself, liable to nothing it has not been
// told about.
await page.getByRole('button', { name: 'Add an item' }).click();
await page.waitForTimeout(900);
await page.getByLabel('What is it called').fill('Procedure incentive');
await page.getByLabel('Short code').fill('PROCEDURE_INCENTIVE');
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/04-add-an-item.png` });
console.log('04 add an item');

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'no console errors');
await browser.close();
