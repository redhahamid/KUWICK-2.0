/**
 * PIECE 3a — the shell and the one screen on the Slate kit, plus two
 * screens that prove what did NOT change.
 *
 * 1440×960 at 2× — the size the mockups were rendered at — so a result can be
 * put beside its mockup without scaling either.
 *
 *   OUT=<dir> node shot-hr-slate-3a.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173';
const OUT = process.env.OUT ?? '/tmp/hr-slate-3a';
const EMAIL = process.env.UAT_EMAIL ?? 'owner@admin-uat.kuwick.invalid';
const PASSWORD = process.env.UAT_PASSWORD ?? 'AdminUat!2026';

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2 });
const page = await context.newPage();

await page.goto(`${BASE}/login`);
const slug = page.locator('input[autocomplete="organization"]');
if (await slug.isVisible().catch(() => false)) await slug.fill('admin-uat');
await page.getByPlaceholder('name@clinic.com').fill(EMAIL);
await page.locator('input[type="password"]').fill(PASSWORD);
await page.getByRole('button', { name: /log in/i }).click();
await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 30_000 });
await page.evaluate(() => {
  try {
    window.sessionStorage.removeItem('kuwick.selectedBranch');
  } catch {
    /* private mode */
  }
});

const PAGES = [
  // The deliverable: shell + Settings landing on Slate.
  ['01-settings-landing', '/admin/hr/settings'],
  // Same shell, a screen still on the old kit — the "two looks" accepted for
  // the transition, shown rather than described.
  ['02-payroll-old-kit-in-slate-shell', '/admin/hr/payroll?period=2026-08'],
  // Not HR. Must look exactly as it did.
  ['03-operation-untouched', '/admin/operation'],
];

for (const [name, path] of PAGES) {
  await page.goto(`${BASE}${path}`);
  await page.locator('.ant-spin-spinning').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await page.mouse.move(2, 2);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  ${name}`);
}

await browser.close();
console.log(`\n${PAGES.length} screenshots in ${OUT}`);
