import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * PIECE 3g, SECOND HALF — clock-in with a selfie and a position, the MC on a
 * medical request, the receipt on a claim, and the two policies in Settings.
 *
 *   OUT=docs/screenshots/hr-slate-3g node apps/web/shot-hr-slate-3g2.mjs
 *
 * Chromium's fake camera stands in for the phone's (a moving test pattern),
 * and the browser is told it is 25 m from the seed's placeholder point.
 * Signed in as the nurse (no punch today), then as the owner for Settings.
 */
const BASE = process.env.BASE ?? 'http://127.0.0.1:5173';
const OUT = process.env.OUT ?? '/tmp/hr-slate-3g';
const PASSWORD = process.env.UAT_PASSWORD ?? 'AdminUat!2026';
const PORTAL = process.env.UAT_EMAIL ?? 'nurse@admin-uat.kuwick.invalid';
const OWNER = process.env.UAT_OWNER ?? 'owner@admin-uat.kuwick.invalid';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});

async function signIn(context, email) {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByPlaceholder('name@clinic.com').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: /log in/i }).click();
  await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 30_000 });
  return page;
}
const settle = async (page, selector = '[data-testid="my-kuwick"]') => {
  await page.waitForSelector(selector, { timeout: 30_000 });
  await page.locator('.ant-spin-spinning').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await page.mouse.move(2, 2);
};
const shoot = async (page, name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  ${name}`);
};

// --- the portal, as the nurse -------------------------------------------
const portal = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  permissions: ['camera', 'geolocation'],
  geolocation: { latitude: 3.13922, longitude: 101.68702 },
});
const page = await signIn(portal, PORTAL);

await page.goto(`${BASE}/my`);
await settle(page);
await page.getByRole('button', { name: /Clock in/ }).click();
await page.getByText('A photo with each punch').waitFor({ timeout: 10_000 });
await page.waitForTimeout(500);
await shoot(page, '09-portal-clock-consent');
await page.getByRole('button', { name: 'I agree' }).click();
await page.locator('.hr-portal__camera video').waitFor({ timeout: 10_000 });
await page.waitForTimeout(1500);
await shoot(page, '10-portal-clock-camera');
await page.getByRole('button', { name: /Take photo and clock in/ }).click();
await page.getByText(/Clocked in/).waitFor({ timeout: 15_000 });
await page.waitForTimeout(800);

await page.setViewportSize({ width: 1440, height: 1100 });
await page.goto(`${BASE}/my/attendance`);
await settle(page);
await page.locator('img.hr-proof').first().waitFor({ timeout: 15_000 }).catch(() => {});
await page.waitForTimeout(600);
await shoot(page, '11-portal-attendance-proof');

// The MC zone on a medical request.
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`${BASE}/my/leave`);
await settle(page);
await page.getByLabel('Type').selectOption('MEDICAL');
await page.getByLabel('From', { exact: true }).fill('2026-10-05');
await page.getByLabel('To', { exact: true }).fill('2026-10-05');
await page.waitForTimeout(1200);
await shoot(page, '12-portal-leave-mc');

// --- Settings, as the owner ---------------------------------------------
const admin = await browser.newContext({ viewport: { width: 1440, height: 1500 }, deviceScaleFactor: 2 });
const owner = await signIn(admin, OWNER);
await owner.goto(`${BASE}/admin/hr/settings/attendance-leave`);
await settle(owner, '.hr-panel');
await owner.locator('.ant-form').first().waitFor({ timeout: 15_000 });
await owner.waitForTimeout(1500);
await shoot(owner, '13-settings-geofence-claims');

await browser.close();
