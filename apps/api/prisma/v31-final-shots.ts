import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from 'dotenv';
import { chromium, Page, BrowserContext } from 'playwright-core';

config({ path: join(__dirname, '..', '.env') });

// V3.1 — THE FINAL ACCEPTANCE PACK (§15): seventeen shots, no near-repeats.
// Admin at 1440×900; the patient flow at the three acceptance widths
// (375 / 390 / 430). Everything through the real UI against the seeded
// month — the busy Wednesday plus the distributed fortnight.
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium';
const API = 'http://localhost:3000';
const WEB = 'http://localhost:5173';
const OUT = join(__dirname, '..', '..', '..', 'docs', 'v3.1-screenshots');

const DESKTOP = { width: 1440, height: 900 };
const BUSY = '26 Aug 2026';
const BUSY_ISO = '2026-08-26';

async function login() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'owner@uat.kuwick.invalid',
      password: process.env.E2E_PASSWORD ?? 'DevLocal!2026',
    }),
  });
  return (await res.json()) as Record<string, unknown>;
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`  ${name}.png`);
}

async function setCalDate(page: Page, text: string) {
  const picker = page.locator('.kw-calendar-toolbar .ant-picker input').first();
  await picker.click();
  await picker.fill(text);
  await picker.press('Enter');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
}

async function seg(page: Page, label: string) {
  await page.locator('.ant-segmented-item-label', { hasText: label }).first().click();
  await page.waitForTimeout(1100);
}

async function setPublicDate(page: Page, iso: string) {
  const dateInput = page.locator('.ant-picker input').first();
  await dateInput.click();
  await dateInput.fill(iso);
  await dateInput.press('Enter');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1600);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const owner = await login();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  console.log(`V3.1 acceptance pack -> ${OUT}`);

  const open = async (
    viewport: { width: number; height: number },
    url: string,
    authed = true,
  ): Promise<{ page: Page; context: BrowserContext }> => {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    if (authed) {
      await context.addInitScript(
        (a) => localStorage.setItem('kuwick-auth', JSON.stringify({ state: a, version: 0 })),
        {
          accessToken: owner.accessToken,
          refreshToken: owner.refreshToken,
          staff: owner.staff,
          tenant: owner.tenant,
        },
      );
    }
    const page = await context.newPage();
    await page.goto(`${WEB}${url}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1400);
    return { page, context };
  };

  // ---- 01–04 · CALENDAR ------------------------------------------------------
  {
    const { page, context } = await open(DESKTOP, '/appointments/calendar');
    await setCalDate(page, BUSY);
    await seg(page, 'Day');
    await shot(page, '01-calendar-day-busy');
    await seg(page, 'Week');
    await shot(page, '02-calendar-week-overlaps');
    await seg(page, 'Month');
    await shot(page, '03-calendar-month-distribution');
    await seg(page, 'Providers');
    await shot(page, '04-calendar-providers');
    await context.close();
  }

  // ---- 05–06 · NEW APPOINTMENT — Time, Review --------------------------------
  {
    const { page, context } = await open(DESKTOP, '/appointments/calendar');
    await setCalDate(page, BUSY);
    await page.getByRole('button', { name: /new appointment/i }).click();
    await page.waitForTimeout(1300);
    const recent = page.locator('.kw-flow-recent-row button').first();
    if ((await recent.count()) > 0) await recent.click();
    await page.waitForTimeout(1000);
    const service = page.locator('.kw-flow-service').first();
    if ((await service.count()) > 0) await service.click();
    await page.waitForTimeout(1200);
    await page.locator('.ant-drawer').getByRole('button', { name: 'Tomorrow' }).click();
    await page.mouse.move(20, 400);
    await page.waitForTimeout(1800);
    await shot(page, '05-new-appointment-time');
    await page.locator('.kw-flow-slot').first().click();
    await page.waitForTimeout(1000);
    const drawerBody = page.locator('.ant-drawer-body').first();
    await drawerBody.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await page.waitForTimeout(400);
    await shot(page, '06-new-appointment-review');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // ---- 07 · DRAWER ---------------------------------------------------------
    const upcoming = page.locator('.rbc-event').filter({ hasText: 'Kavitha' }).first();
    if ((await upcoming.count()) > 0) await upcoming.click();
    else await page.locator('.rbc-event').first().click();
    await page.waitForTimeout(1300);
    await shot(page, '07-appointment-drawer');
    await context.close();
  }

  // ---- 08–11 · LIST, ROSTER, SERVICES, BOOKING PAGE --------------------------
  {
    const { page, context } = await open(DESKTOP, '/appointments/list');
    await shot(page, '08-list');
    await context.close();
  }
  {
    const { page, context } = await open(DESKTOP, '/appointments/roster');
    const monthPicker = page.locator('.kw-roster-toolbar .ant-picker input').first();
    await monthPicker.click();
    await monthPicker.fill('2026-08');
    await monthPicker.press('Enter');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1400);
    await shot(page, '09-roster');
    await context.close();
  }
  {
    const { page, context } = await open(DESKTOP, '/appointments/services');
    await shot(page, '10-services');
    await context.close();
  }
  {
    const { page, context } = await open(DESKTOP, '/appointments/booking-page');
    await shot(page, '11-booking-page-builder');
    await context.close();
  }

  // ---- 12, 15–17 · PUBLIC at 390 ---------------------------------------------
  {
    const { page, context } = await open({ width: 390, height: 844 }, '/book/uat-clinic', false);
    await page.getByText('GP Consultation', { exact: false }).first().click();
    await page.waitForTimeout(2500); // the engine hints land
    await page.mouse.move(10, 800);
    await shot(page, '12-public-doctor-390');

    await page.getByRole('button', { name: /continue/i }).first().click();
    await page.waitForTimeout(1400);
    await setPublicDate(page, BUSY_ISO);
    await page.locator('.kw-public-slots .ant-btn').last().click();
    await page.waitForTimeout(1000);
    await page.getByLabel(/your full name/i).fill('Nur Aina binti Kamal');
    await page.getByLabel(/mobile number/i).fill('0129990011');
    await page.getByRole('button', { name: /review booking/i }).click();
    await page.waitForTimeout(1000);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, '15-public-review-390');

    await page.getByRole('button', { name: /confirm appointment/i }).click();
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, '16-public-confirmation-390');

    const manage = page.getByRole('link', { name: /manage my appointment/i });
    if ((await manage.count()) > 0) await manage.click();
    else await page.getByRole('button', { name: /manage my appointment/i }).click();
    await page.waitForTimeout(2000);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, '17-public-manage-390');
    await context.close();
  }

  // ---- 13–14 · PUBLIC TIME at 375 and 430 -------------------------------------
  for (const width of [375, 430] as const) {
    const { page, context } = await open({ width, height: 844 }, '/book/uat-clinic', false);
    await page.getByText('GP Consultation', { exact: false }).first().click();
    await page.waitForTimeout(1600);
    await page.getByRole('button', { name: /continue/i }).first().click();
    await page.waitForTimeout(1400);
    await setPublicDate(page, BUSY_ISO);
    await page.mouse.move(10, 800);
    await shot(page, width === 375 ? '13-public-time-375' : '14-public-time-430');
    await context.close();
  }

  await browser.close();
  console.log('done');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
