/**
 * THE PAYROLL SIMPLE UX SCREENSHOT PACK.
 *
 * Runs against the synthetic admin UAT tenant seeded by
 * `apps/api/prisma/seed-admin-uat.ts` — invented names, `.invalid` accounts,
 * invented figures. It opens the real screens in a real browser at five
 * viewports and captures them ONE AT A TIME. No collages: a collage is a
 * picture of a picture, and it hides exactly the density and alignment
 * problems these shots exist to find.
 *
 *   OUT=<dir> node shot-payroll.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173';
const OUT = process.env.OUT ?? '/tmp/shots';
const EMAIL = process.env.UAT_EMAIL ?? 'owner@admin-uat.kuwick.invalid';
const PASSWORD = process.env.UAT_PASSWORD ?? 'AdminUat!2026';

const VIEWPORTS = {
  desktop: { width: 1512, height: 960 },
  laptop: { width: 1280, height: 800 },
  ipadLandscape: { width: 1180, height: 820 },
  ipadPortrait: { width: 820, height: 1180 },
  mobile: { width: 390, height: 844 },
};

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium' });

async function signedInPage(viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  const slug = page.locator('input[autocomplete="organization"]');
  if (await slug.isVisible().catch(() => false)) await slug.fill('admin-uat');
  await page.getByPlaceholder('name@clinic.com').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: /log in/i }).click();
  await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 30_000 });
  // A sticky branch filter leaks between shots and silently empties a register.
  await page.evaluate(() => {
    try {
      window.sessionStorage.removeItem('kuwick.selectedBranch');
    } catch {
      /* private mode */
    }
  });
  return { context, page };
}

/** Land, let the data arrive, and park the pointer so nothing is hover-lit. */
async function settle(page, path, { wait = 1200, selector } = {}) {
  await page.goto(`${BASE}${path}`);
  await page.waitForSelector('.kw-admin', { timeout: 30_000 }).catch(() => {});
  if (selector) await page.waitForSelector(selector, { timeout: 30_000 }).catch(() => {});
  await page.locator('.ant-spin-spinning').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {});
  await page.mouse.move(2, 2);
  await page.waitForTimeout(wait);
}

const shots = [];
async function shot(page, name) {
  const file = `${OUT}/${name}.png`;
  await page.screenshot({ path: file, fullPage: false });
  shots.push(name);
  console.log(`  ${name}`);
}

// ---------------------------------------------------------------------------
// DESKTOP — 1512×960
// ---------------------------------------------------------------------------
console.log('desktop');
{
  const { context, page } = await signedInPage(VIEWPORTS.desktop);

  // 1 — the register, which is what /admin/hr/payroll now opens on.
  await settle(page, '/admin/hr/payroll?period=2026-08', { selector: '.kw-payrollGrid' });
  await shot(page, '01-desktop-payroll-register');

  // 2 — one person's payslip, over the register that stays put behind it.
  await page.locator('tbody .ant-table-row').first().click();
  await page.waitForSelector('.ant-drawer-open', { timeout: 15_000 });
  await page.waitForTimeout(900);
  await shot(page, '02-desktop-employee-drawer');

  // 3 — the compact editor, inside the section it adds to.
  const add = page.getByRole('button', { name: '+ Add earning' });
  if (await add.isVisible().catch(() => false)) {
    await add.click();
    await page.waitForTimeout(700);
    await shot(page, '03-desktop-add-earning');
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);

  // 4 — a row that cannot be paid, and 5 — one worth a look. Both are on the
  // register beside the person, which is the whole point of the change.
  await settle(page, '/admin/hr/payroll?period=2026-08', { selector: '.kw-payrollGrid' });
  const blocked = page.locator('.kw-payrollGrid__row--blocked').first();
  if (await blocked.isVisible().catch(() => false)) {
    await blocked.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
  }
  await shot(page, '04-desktop-register-blocker');

  await settle(page, '/admin/hr/payroll?period=2026-08&step=review', { selector: '.kw-statStrip' });
  await shot(page, '05-desktop-register-warning');

  // 6 — Review: what needs looking at, and what the month comes to.
  await shot(page, '06-desktop-review');

  // 7 — Approve.
  await settle(page, '/admin/hr/payroll?period=2026-08&step=approve');
  await shot(page, '07-desktop-approve');

  // 8 — Finalise.
  await settle(page, '/admin/hr/payroll?period=2026-08&step=complete');
  await shot(page, '08-desktop-finalise');

  // 9 — History, and 10 — a month opened from it.
  await settle(page, '/admin/hr/payroll/history');
  await shot(page, '09-desktop-history');

  const monthLink = page.locator('a.kw-linkStrong').first();
  if (await monthLink.isVisible().catch(() => false)) {
    await monthLink.click();
    await page.waitForSelector('.kw-payMonth', { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(1400);
    await shot(page, '10-desktop-historical-month');
  }

  // 11 — HR Overview, 12 — Employees.
  await settle(page, '/admin/hr');
  await shot(page, '11-desktop-hr-overview');
  await settle(page, '/admin/hr/people');
  await shot(page, '12-desktop-employees');

  // Extra: the column chooser open, which is how a register stays readable
  // without losing the components a clinic actually uses.
  await settle(page, '/admin/hr/payroll?period=2026-08', { selector: '.kw-payrollGrid' });
  const columns = page.getByRole('button', { name: /Columns/ });
  if (await columns.isVisible().catch(() => false)) {
    await columns.click();
    await page.waitForTimeout(700);
    await shot(page, '12b-desktop-column-chooser');
  }

  await context.close();
}

// ---------------------------------------------------------------------------
// LAPTOP — 1280×800 (Employee and Net Pay must survive)
// ---------------------------------------------------------------------------
console.log('laptop');
{
  const { context, page } = await signedInPage(VIEWPORTS.laptop);
  await settle(page, '/admin/hr/payroll?period=2026-08', { selector: '.kw-payrollGrid' });
  await shot(page, '13b-laptop-payroll-register');
  await context.close();
}

// ---------------------------------------------------------------------------
// IPAD LANDSCAPE — 1180×820
// ---------------------------------------------------------------------------
console.log('ipad landscape');
{
  const { context, page } = await signedInPage(VIEWPORTS.ipadLandscape);
  await settle(page, '/admin/hr/payroll?period=2026-08', { selector: '.kw-payrollGrid' });
  await shot(page, '13-ipad-landscape-register');

  await page.locator('tbody .ant-table-row').first().click();
  await page.waitForSelector('.ant-drawer-open', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(900);
  await shot(page, '14-ipad-landscape-drawer');

  await settle(page, '/admin/hr/payroll?period=2026-08&step=review', { selector: '.kw-statStrip' });
  await shot(page, '15-ipad-landscape-review');
  await context.close();
}

// ---------------------------------------------------------------------------
// IPAD PORTRAIT — 820×1180
// ---------------------------------------------------------------------------
console.log('ipad portrait');
{
  const { context, page } = await signedInPage(VIEWPORTS.ipadPortrait);
  await settle(page, '/admin/hr/payroll?period=2026-08');
  await shot(page, '16-ipad-portrait-register');
  await settle(page, '/admin/hr/payroll?period=2026-08&step=review');
  await shot(page, '17-ipad-portrait-review');
  await context.close();
}

// ---------------------------------------------------------------------------
// MOBILE — 390×844. Cards, never a squeezed spreadsheet.
// ---------------------------------------------------------------------------
console.log('mobile');
{
  const { context, page } = await signedInPage(VIEWPORTS.mobile);
  await settle(page, '/admin/hr/payroll?period=2026-08');
  await shot(page, '18-mobile-payroll-month');

  await page.evaluate(() => {
    document.querySelector('.kw-payCards')?.scrollIntoView({ block: 'start' });
  });
  await page.waitForTimeout(700);
  await shot(page, '19-mobile-employee-cards');

  const more = page.getByRole('button', { name: 'View details' }).first();
  if (await more.isVisible().catch(() => false)) {
    await more.click();
    await page.waitForSelector('.ant-drawer-open', { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(900);
    await shot(page, '20-mobile-employee-details');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }

  await settle(page, '/admin/hr/payroll?period=2026-08&step=review');
  await shot(page, '21-mobile-review');
  await settle(page, '/admin/hr/payroll?period=2026-08&step=complete');
  await shot(page, '22-mobile-finalise');
  await context.close();
}

await browser.close();
console.log(`\n${shots.length} screenshots in ${OUT}`);
