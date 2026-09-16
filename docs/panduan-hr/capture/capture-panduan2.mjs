import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = 'http://localhost:5173';
const OUT = resolve(HERE, '..', 'shots');
const login = async (page, email) => {
  await page.goto(`${WEB}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill('AdminUat!2026');
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30000 });
};
const settle = async (page) => {
  try { await page.locator('.ant-spin-spinning').waitFor({ state: 'detached', timeout: 15000 }); } catch {}
  await page.waitForTimeout(1200);
};
const shot = async (page, name, size) => {
  await page.screenshot({ path: `${OUT}/${name}-${size}.png` });
  console.log(`  ${size.padEnd(7)} ${name}`);
};

const run = async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  for (const [size, viewport] of [['desktop', { width: 1440, height: 950 }], ['phone', { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await login(page, 'owner@admin-uat.kuwick.invalid');

    // 06b — the untaken-leave payout choice, below the attendance rules.
    await page.goto(`${WEB}/admin/hr/settings/attendance-leave`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    try {
      await page.getByText('Untaken annual leave when somebody leaves').scrollIntoViewIfNeeded();
      await page.waitForTimeout(600);
      await shot(page, '06b-leave-payout', size);
    } catch (e) { console.log(`  ${size} 06b FAILED ${String(e).slice(0,70)}`); }

    // 05b — a rule set open, where the PCB projection and multipliers live.
    await page.goto(`${WEB}/admin/hr/settings/payroll`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    try {
      await page.getByRole('button', { name: /^Edit$/ }).first().click();
      await page.waitForTimeout(1500);
      await page.getByText('How the rest of the year is estimated for monthly tax').scrollIntoViewIfNeeded();
      await page.waitForTimeout(600);
      await shot(page, '05b-pcb-projection', size);
    } catch (e) { console.log(`  ${size} 05b FAILED ${String(e).slice(0,70)}`); }

    // 09 — an employee's Statutory tab: EPF rate, SKBBK, PCB category.
    await page.goto(`${WEB}/admin/hr/employees`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    try {
      await page.getByRole('link', { name: /Dr Meera Kaur/ }).first().click();
      await page.waitForTimeout(2000);
      await page.getByRole('tab', { name: /Statutory/i }).click();
      await settle(page);
      await shot(page, '09-employee-statutory', size);
    } catch (e) { console.log(`  ${size} 09 FAILED ${String(e).slice(0,70)}`); }

    await ctx.close();
  }
  await browser.close();
};
run().catch((e) => { console.error(e); process.exit(1); });
