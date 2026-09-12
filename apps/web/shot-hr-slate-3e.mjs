import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * PIECE 3e SCREENSHOTS — Attendance, Leave and Claims as the manager sees
 * them, signed in as the demo owner on the admin-uat world.
 *
 *   OUT=docs/screenshots/hr-slate-3e node apps/web/shot-hr-slate-3e.mjs
 *
 * ONLY=attendance (or leave, claims) shoots one screen while iterating.
 */
const BASE = process.env.BASE ?? 'http://127.0.0.1:5173';
const OUT = process.env.OUT ?? '/tmp/hr-slate-3e';
const EMAIL = process.env.UAT_EMAIL ?? 'owner@admin-uat.kuwick.invalid';
const PASSWORD = process.env.UAT_PASSWORD ?? 'AdminUat!2026';
const ONLY = process.env.ONLY ?? '';
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
  await page.waitForTimeout(1500);
  await page.mouse.move(2, 2);
};

for (const [name, path, height] of [
  ['01-attendance', '/admin/hr/attendance', 1000],
  ['02-leave', '/admin/hr/leave', 1000],
  ['03-claims', '/admin/hr/claims', 1000],
]) {
  if (ONLY && !name.includes(ONLY)) continue;
  await page.setViewportSize({ width: 1440, height });
  await page.goto(`${BASE}${path}`);
  await settle();
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  ${name}`);
}

// The two decisions, in their drawers: everything the manager needs is in one.
for (const [name, path] of [
  ['04-leave-review', '/admin/hr/leave'],
  ['05-claims-review', '/admin/hr/claims'],
]) {
  if (ONLY && !name.includes(ONLY)) continue;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${BASE}${path}`);
  await settle();
  const review = page.getByRole('button', { name: 'Review' }).first();
  await review.waitFor({ timeout: 20_000 }).catch(() => {});
  if (!(await review.count())) {
    console.log(`  ${name}: nothing to review`);
    continue;
  }
  await review.click();
  await page.locator('.hr-drawer').waitFor({ timeout: 10_000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  ${name}`);
}

// The corrections queue and the month, so the other two tabs are on the record.
if (!ONLY) {
  await page.goto(`${BASE}/admin/hr/attendance`);
  await settle();
  await page.getByRole('tab', { name: /Monthly summary/ }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/06-attendance-month.png` });
  console.log('  06-attendance-month');
}

if (errors.length) console.log('console errors:', errors.slice(0, 5));
await browser.close();
