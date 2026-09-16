import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const HERE = dirname(fileURLToPath(import.meta.url));

const WEB = 'http://localhost:5173';
const PASS = 'AdminUat!2026';
const OUT = resolve(HERE, '..', 'shots');
mkdirSync(OUT, { recursive: true });

const DESKTOP = { width: 1440, height: 950 };
const PHONE = { width: 390, height: 844 };

/** Every screen the guide shows, in the order a clinic meets them. */
const SHOTS = [
  // 1. Setup
  ['owner', '/admin/hr/settings', '01-settings'],
  ['owner', '/admin/hr/settings/company', '02-company'],
  ['owner', '/admin/hr/settings/statutory', '03-statutory-rates'],
  ['owner', '/admin/hr/settings/payroll-items', '04-payroll-items'],
  ['owner', '/admin/hr/settings/payroll', '05-payroll-policies'],
  ['owner', '/admin/hr/settings/attendance-leave', '06-attendance-leave'],
  ['owner', '/admin/hr/settings/public-holidays', '07-public-holidays'],
  // 2. Employees
  ['owner', '/admin/hr/employees', '08-employees'],
  // 3-4. Roster and attendance
  ['owner', '/admin/hr/roster', '10-roster'],
  ['owner', '/admin/hr/attendance', '11-attendance'],
  // 5-6. Leave and claims, seen by the manager
  ['manager', '/admin/hr/leave', '13-leave-admin'],
  ['manager', '/admin/hr/claims', '15-claims-admin'],
  // 7-8. Payroll and payment
  ['owner', '/admin/hr/payroll', '17-payroll-month'],
  ['owner', '/admin/hr/payroll/history', '21-payroll-history'],
  ['owner', '/admin/hr/reports', '22-reports'],
  // 9. The portal
  ['resident', '/my', '23-portal-home'],
  ['resident', '/my/payslips', '24-portal-payslips'],
  ['resident', '/my/leave', '25-portal-leave'],
  ['resident', '/my/claims', '26-portal-claims'],
  ['resident', '/my/attendance', '27-portal-attendance'],
];

const EMAIL = {
  owner: 'owner@admin-uat.kuwick.invalid',
  manager: 'manager@admin-uat.kuwick.invalid',
  resident: 'resident@admin-uat.kuwick.invalid',
};

const login = async (page, who) => {
  await page.goto(`${WEB}/login`);
  await page.getByLabel(/email/i).fill(EMAIL[who]);
  await page.getByLabel(/password/i).fill(PASS);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30000 });
};

const settle = async (page) => {
  try { await page.locator('.ant-spin-spinning').waitFor({ state: 'detached', timeout: 15000 }); } catch {}
  await page.waitForTimeout(1200);
};

const run = async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  for (const [size, viewport] of [['desktop', DESKTOP], ['phone', PHONE]]) {
    let current = null;
    let ctx = null;
    let page = null;
    for (const [who, path, name] of SHOTS) {
      if (who !== current) {
        if (ctx) await ctx.close();
        ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
        page = await ctx.newPage();
        await login(page, who);
        current = who;
      }
      try {
        await page.goto(`${WEB}${path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await settle(page);
        await page.screenshot({ path: `${OUT}/${name}-${size}.png`, fullPage: false });
        console.log(`  ${size.padEnd(7)} ${name}`);
      } catch (e) {
        console.log(`  ${size.padEnd(7)} ${name}  FAILED: ${String(e).slice(0, 90)}`);
      }
    }
    if (ctx) await ctx.close();
  }
  await browser.close();
};
run().catch((e) => { console.error(e); process.exit(1); });
