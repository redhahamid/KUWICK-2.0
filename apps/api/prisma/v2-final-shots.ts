import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from 'dotenv';
import { chromium, Page, BrowserContext } from 'playwright-core';

config({ path: join(__dirname, '..', '.env') });

// §52 — THE FINAL 29. Captured after the V2 enterprise visual redesign,
// against the seeded Klinik Hijraa-shaped week, through the real UI. The
// numbering follows the brief exactly: 01–17 admin, 18–21 public desktop,
// 22–29 public mobile at 390px.
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium';
const API = 'http://localhost:3000';
const WEB = 'http://localhost:5173';
const OUT = join(__dirname, '..', '..', '..', 'docs', 'v2-final-screenshots');

const DESKTOP = { width: 1440, height: 1000 };
const MOBILE = { width: 390, height: 844 };
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
  const picker = page.locator('.kw-calendar-workspace .ant-picker input').first();
  await picker.click();
  await picker.fill(text);
  await picker.press('Enter');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
}

async function seg(page: Page, label: string) {
  await page.locator('.ant-segmented-item-label', { hasText: label }).first().click();
  await page.waitForTimeout(1000);
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
  console.log(`V2 final screenshots -> ${OUT}`);

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

  // ---- ADMIN 01–09: calendar, drawer, new appointment ----------------------
  {
    const { page, context } = await open(DESKTOP, '/appointments/calendar');
    await setCalDate(page, BUSY);
    await seg(page, 'Day');
    await shot(page, '01-admin-calendar-day-busy');
    await seg(page, 'Week');
    await shot(page, '02-admin-calendar-week');
    await seg(page, 'Month');
    await shot(page, '03-admin-calendar-month');
    await seg(page, 'Providers');
    await shot(page, '04-admin-calendar-providers');

    // 05 — drawer on an upcoming (confirmed) booking: the EXPANDED hour card.
    await seg(page, 'Day');
    const upcoming = page.locator('.rbc-event').filter({ hasText: 'Kavitha' }).first();
    if ((await upcoming.count()) > 0) await upcoming.click();
    else await page.locator('.rbc-event').first().click();
    await page.waitForTimeout(1300);
    await shot(page, '05-admin-drawer-upcoming');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // 06 — drawer on the checked-in patient: the queue banner outranks all.
    const inClinic = page.locator('.rbc-event').filter({ hasText: 'Rajesh' }).first();
    if ((await inClinic.count()) > 0) {
      await inClinic.click();
      await page.waitForTimeout(1300);
      await shot(page, '06-admin-drawer-checked-in');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }

    // 07–09 — the progressive New Appointment flow, step by step.
    await page.getByRole('button', { name: /new appointment/i }).click();
    await page.waitForTimeout(1300);
    await shot(page, '07-admin-new-appointment-patient');

    const recent = page.locator('.kw-flow-recent-row button').first();
    if ((await recent.count()) > 0) await recent.click();
    await page.waitForTimeout(900);
    const service = page.locator('.kw-flow-service').first();
    if ((await service.count()) > 0) await service.click();
    await page.waitForTimeout(1500);
    await shot(page, '08-admin-new-appointment-provider');

    // Scroll the drawer to the time groups and pick a slot so the review
    // card is on screen too.
    const drawerBody = page.locator('.ant-drawer-body').first();
    await drawerBody.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await page.waitForTimeout(600);
    const slotChip = page
      .locator('.ant-drawer-body .ant-btn')
      .filter({ hasText: /^\d{2}:\d{2}/ })
      .first();
    if ((await slotChip.count()) > 0) {
      await slotChip.click();
      await page.waitForTimeout(800);
      await drawerBody.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    }
    await shot(page, '09-admin-new-appointment-time');
    await context.close();
  }

  // ---- ADMIN 10: list -------------------------------------------------------
  {
    const { page, context } = await open(DESKTOP, '/appointments/list');
    await shot(page, '10-admin-list');
    await context.close();
  }

  // ---- ADMIN 11–13: roster board, cell editor, fixed weekly ----------------
  {
    const { page, context } = await open(DESKTOP, '/appointments/roster');
    await shot(page, '11-admin-roster-month');

    const chip = page
      .locator('.kw-roster-chip')
      .filter({ hasText: /\d{2}:\d{2}/ })
      .first();
    if ((await chip.count()) > 0) {
      await chip.click();
      await page.waitForTimeout(1200);
      await shot(page, '12-admin-roster-cell-editor');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(600);
    }

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(600);
    await shot(page, '13-admin-fixed-weekly-collapsed');
    await context.close();
  }

  // ---- ADMIN 14–15: services ------------------------------------------------
  {
    const { page, context } = await open(DESKTOP, '/appointments/services');
    await shot(page, '14-admin-services-list');
    await page.getByRole('button', { name: 'Edit' }).first().click();
    await page.waitForTimeout(1200);
    await page.locator('.ant-drawer .ant-tabs-tab', { hasText: 'Scheduling' }).first().click();
    await page.waitForTimeout(800);
    await shot(page, '15-admin-service-scheduling');
    await context.close();
  }

  // ---- ADMIN 16–17: booking page settings -----------------------------------
  {
    const { page, context } = await open(DESKTOP, '/appointments/booking-page');
    await shot(page, '16-admin-booking-page-general');
    await page.locator('.ant-tabs-tab', { hasText: 'Sharing' }).first().click();
    await page.waitForTimeout(1000);
    await shot(page, '17-admin-booking-page-sharing');
    await context.close();
  }

  // ---- PUBLIC DESKTOP 18–21 --------------------------------------------------
  {
    const { page, context } = await open(DESKTOP, '/book/uat-clinic', false);
    await shot(page, '18-public-desktop-service');

    await page.getByText('GP Consultation', { exact: false }).first().click();
    await page.waitForTimeout(2500); // the next-available hints land
    await shot(page, '19-public-desktop-provider');

    await page.getByRole('button', { name: /continue/i }).first().click();
    await page.waitForTimeout(1400);
    await setPublicDate(page, BUSY_ISO);
    await shot(page, '20-public-desktop-time');

    // A real booking through the real engine, so the confirmation is true.
    await page.locator('.kw-public-slots .ant-btn').last().click();
    await page.waitForTimeout(1000);
    await page.getByLabel(/your full name/i).fill('Harjinder Kaur');
    await page.getByLabel(/mobile number/i).fill('0127770101');
    await page.getByRole('button', { name: /review booking/i }).click();
    await page.waitForTimeout(900);
    await page.getByRole('button', { name: /confirm appointment/i }).click();
    await page.waitForTimeout(2500);
    await shot(page, '21-public-desktop-confirmation');
    await context.close();
  }

  // ---- PUBLIC MOBILE 22–29 ----------------------------------------------------
  {
    const { page, context } = await open(MOBILE, '/book/uat-clinic', false);
    await shot(page, '22-public-mobile-service');

    await page.getByText('GP Consultation', { exact: false }).first().click();
    await page.waitForTimeout(2500);
    await shot(page, '23-public-mobile-provider');

    await page.getByRole('button', { name: /continue/i }).first().click();
    await page.waitForTimeout(1400);
    await setPublicDate(page, BUSY_ISO);
    await shot(page, '24-public-mobile-time-available');

    // 25 — no availability: today sits inside the clinic's minimum notice,
    // and the page goes looking for the next free day itself.
    await setPublicDate(page, new Date().toISOString().slice(0, 10));
    await page.waitForTimeout(4500);
    await shot(page, '25-public-mobile-no-availability');

    // Back to the busy day, pick whatever the engine still has open.
    await setPublicDate(page, BUSY_ISO);
    await page.locator('.kw-public-slots .ant-btn').last().click();
    await page.waitForTimeout(1000);

    await page.getByLabel(/your full name/i).fill('Nur Aina binti Kamal');
    await page.getByLabel(/mobile number/i).fill('0129990011');
    await shot(page, '26-public-mobile-details');

    await page.getByRole('button', { name: /review booking/i }).click();
    await page.waitForTimeout(1000);
    await shot(page, '27-public-mobile-review');

    await page.getByRole('button', { name: /confirm appointment/i }).click();
    await page.waitForTimeout(2500);
    await shot(page, '28-public-mobile-confirmation');

    const manage = page.getByRole('link', { name: /manage my appointment/i });
    if ((await manage.count()) > 0) await manage.click();
    else await page.getByRole('button', { name: /manage my appointment/i }).click();
    await page.waitForTimeout(2000);
    await shot(page, '29-public-mobile-manage');
    await context.close();
  }

  await browser.close();
  console.log('done');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
