/**
 * PIECE 3d — Payroll on the Slate kit, at 1440px, against the synthetic
 * admin UAT tenant. Individual files, never a collage.
 *
 *   OUT=<dir> PERIOD=2026-08 node shot-hr-slate-3d.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173';
const OUT = process.env.OUT ?? '/tmp/hr-slate-3d';
const EMAIL = process.env.UAT_EMAIL ?? 'owner@admin-uat.kuwick.invalid';
const PASSWORD = process.env.UAT_PASSWORD ?? 'AdminUat!2026';
const PERIOD = process.env.PERIOD ?? '2026-08';
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

// payroll.html was rendered at 1720 wide — the one mockup wider than 1440 —
// so the grid is shot at the width it was drawn for, and the rest at 1440.
const wide = async (name, height) => {
  await page.setViewportSize({ width: 1720, height });
  await page.mouse.move(2, 2);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  ${name}`);
};
await page.setViewportSize({ width: 1720, height: 1200 });
await page.goto(`${BASE}/admin/hr/payroll?period=${PERIOD}`);
await settle();
await wide('01-payroll', 1200);

// One row in edit, as the mockup shows it.
const editButtons = page.getByRole('button', { name: /^Edit$/ });
if ((await editButtons.count()) > 2) {
  await editButtons.nth(2).click();
  await page.waitForTimeout(300);
  await wide('01b-payroll-editing', 1200);
  await page.getByRole('button', { name: 'Cancel' }).click();
}

// The other three stages, for the record: Review, Approve, Pay.
const runUrl = new URL(page.url());
for (const [name, step, height] of [
  ['03-payroll-review', 'review', 1400],
  ['04-payroll-approve', 'approve', 1300],
  ['05-payroll-pay', 'complete', 900],
]) {
  runUrl.searchParams.set('step', step);
  await page.goto(runUrl.toString());
  await settle();
  await shoot(name, height);
}
runUrl.searchParams.set('step', 'prepare');
await page.goto(runUrl.toString());
await settle();

// The person: found from the grid by name, as a person would.
await page.getByRole('link', { name: new RegExp(WHO) }).first().click();
await page.waitForURL(/\/admin\/hr\/payroll\/[0-9a-f-]+\/employees\/[0-9a-f-]+/, { timeout: 30_000 });
await settle();
await shoot('02-employee-payroll', 1300);

await browser.close();
console.log(`\nscreenshots in ${OUT}`);
