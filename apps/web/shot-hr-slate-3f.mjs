import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * PIECE 3f SCREENSHOTS — the reports shelf, signed in as the demo owner.
 *
 *   OUT=docs/screenshots/hr-slate-3f node apps/web/shot-hr-slate-3f.mjs
 */
const BASE = process.env.BASE ?? 'http://127.0.0.1:5173';
const OUT = process.env.OUT ?? '/tmp/hr-slate-3f';
const EMAIL = process.env.UAT_EMAIL ?? 'owner@admin-uat.kuwick.invalid';
const PASSWORD = process.env.UAT_PASSWORD ?? 'AdminUat!2026';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1600 }, deviceScaleFactor: 2 });
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
  await page.waitForTimeout(2000);
  await page.mouse.move(2, 2);
};

await page.goto(`${BASE}/admin/hr/reports`);
await settle();
await page.screenshot({ path: `${OUT}/01-reports.png` });
console.log('  01-reports');

// One report open, so the deep link and the chrome around it are on the record.
await page.setViewportSize({ width: 1440, height: 1100 });
await page.goto(`${BASE}/admin/hr/reports?report=PAYROLL_REGISTER`);
await settle();
await page.screenshot({ path: `${OUT}/02-report-open.png` });
console.log('  02-report-open');

if (errors.length) console.log('console errors:', errors.slice(0, 5));
await browser.close();
