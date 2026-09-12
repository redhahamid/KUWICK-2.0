import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * PIECE 3g SCREENSHOTS — the employee portal, signed in as a demo employee.
 *
 *   OUT=docs/screenshots/hr-slate-3g node apps/web/shot-hr-slate-3g.mjs
 *
 * Desktop at 1440 (2×), then the home and leave pages at phone width.
 */
const BASE = process.env.BASE ?? 'http://127.0.0.1:5173';
const OUT = process.env.OUT ?? '/tmp/hr-slate-3g';
const EMAIL = process.env.UAT_EMAIL ?? 'resident@admin-uat.kuwick.invalid';
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

const settle = async () => {
  await page.waitForSelector('[data-testid="my-kuwick"]', { timeout: 30_000 });
  await page.locator('.ant-spin-spinning').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await page.mouse.move(2, 2);
};
const shoot = async (name, width, height) => {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  ${name}`);
};

for (const [name, path, height] of [
  ['01-portal-home', '/my', 900],
  ['02-portal-leave', '/my/leave', 900],
  ['03-portal-claims', '/my/claims', 900],
  ['04-portal-payslips', '/my/payslips', 700],
  ['05-portal-attendance', '/my/attendance', 1100],
  ['06-portal-profile', '/my/profile', 700],
]) {
  await page.setViewportSize({ width: 1440, height });
  await page.goto(`${BASE}${path}`);
  await settle();
  if (path === '/my/leave') {
    await page.getByLabel('From', { exact: true }).fill('2026-09-28');
    await page.getByLabel('To', { exact: true }).fill('2026-09-30');
    await page.waitForTimeout(1200);
  }
  if (path === '/my/claims') {
    await page.getByLabel('From', { exact: true }).fill('Contoh Central');
    await page.getByLabel('To', { exact: true }).fill('Contoh Bandar (return)');
    await page.getByLabel('Distance').fill('42');
    await page.getByLabel('Purpose').fill('Deliver vaccine stock');
    await page.waitForTimeout(300);
  }
  await shoot(name, 1440, height);
}

for (const [name, path, height] of [
  ['07-portal-home-phone', '/my', 844],
  ['08-portal-leave-phone', '/my/leave', 1400],
]) {
  await page.setViewportSize({ width: 390, height });
  await page.goto(`${BASE}${path}`);
  await settle();
  await shoot(name, 390, height);
}

await browser.close();
