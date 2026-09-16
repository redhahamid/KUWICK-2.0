import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = 'http://localhost:5173';
const OUT = resolve(HERE, '..', 'shots');
const MEERA = '6d7b6cd5-f23d-4fc3-a1dd-df19e467d039';
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
const run = async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  for (const [size, viewport] of [['desktop', { width: 1440, height: 950 }], ['phone', { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await login(page, 'owner@admin-uat.kuwick.invalid');

    // 05b — scroll the DRAWER, not the page, so the tax projection is in frame.
    await page.goto(`${WEB}/admin/hr/settings/payroll`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    try {
      await page.getByRole('button', { name: /^Edit$/ }).first().click();
      await page.waitForTimeout(1500);
      const field = page.locator('#ruleset-pcb-projection');
      await field.scrollIntoViewIfNeeded();
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${OUT}/05b-pcb-projection-${size}.png` });
      console.log(`  ${size.padEnd(7)} 05b-pcb-projection`);
    } catch (e) { console.log(`  ${size} 05b FAILED ${String(e).slice(0,70)}`); }

    // 09 — the Statutory tab: EPF rate, SKBBK, PCB category.
    try {
      await page.goto(`${WEB}/admin/hr/employees/${MEERA}`, { waitUntil: 'domcontentloaded' });
      await settle(page);
      await page.getByRole('tab', { name: /Statutory/i }).click();
      await settle(page);
      await page.screenshot({ path: `${OUT}/09-employee-statutory-${size}.png` });
      console.log(`  ${size.padEnd(7)} 09-employee-statutory`);
    } catch (e) { console.log(`  ${size} 09 FAILED ${String(e).slice(0,70)}`); }

    await ctx.close();
  }
  await browser.close();
};
run().catch((e) => { console.error(e); process.exit(1); });
