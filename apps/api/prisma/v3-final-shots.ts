import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from 'dotenv';
import { chromium, Page, BrowserContext } from 'playwright-core';

config({ path: join(__dirname, '..', '.env') });

// V3 — THE ACCEPTANCE SET. Captured against the seeded Klinik Hijraa-shaped
// week through the real UI, at the brief's priority viewports: admin at
// 1440×900, patient flow at 390×844. The list follows V3 §12 exactly — every
// shot on populated data, never an empty screen as the acceptance evidence.
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium';
const API = 'http://localhost:3000';
const WEB = 'http://localhost:5173';
const OUT = join(__dirname, '..', '..', '..', 'docs', 'v3-screenshots');

const DESKTOP = { width: 1440, height: 900 };
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
  console.log(`V3 screenshots -> ${OUT}`);

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

  // ---- 01–06 · CALENDAR + DRAWERS -----------------------------------------
  {
    const { page, context } = await open(DESKTOP, '/appointments/calendar');
    await setCalDate(page, BUSY);
    await seg(page, 'Day');
    await shot(page, '01-calendar-day-busy');
    await seg(page, 'Week');
    await shot(page, '02-calendar-week');
    await seg(page, 'Month');
    await shot(page, '03-calendar-month');
    await seg(page, 'Providers');
    await shot(page, '04-calendar-providers');

    // 05 — drawer on an upcoming (confirmed) booking.
    await seg(page, 'Day');
    const upcoming = page.locator('.rbc-event').filter({ hasText: 'Kavitha' }).first();
    if ((await upcoming.count()) > 0) await upcoming.click();
    else await page.locator('.rbc-event').first().click();
    await page.waitForTimeout(1300);
    await shot(page, '05-drawer-upcoming');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // 06 — drawer on the checked-in patient: the queue banner outranks all.
    const inClinic = page.locator('.rbc-event').filter({ hasText: 'Rajesh' }).first();
    if ((await inClinic.count()) > 0) {
      await inClinic.click();
      await page.waitForTimeout(1300);
      await shot(page, '06-drawer-checked-in');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
    await context.close();
  }

  // ---- 07–10 · NEW APPOINTMENT, step by step -------------------------------
  {
    const { page, context } = await open(DESKTOP, '/appointments/calendar');
    await setCalDate(page, BUSY);
    await page.getByRole('button', { name: /new appointment/i }).click();
    await page.waitForTimeout(1300);

    // Pick a patient → the SERVICE step opens with the patient collapsed.
    const recent = page.locator('.kw-flow-recent-row button').first();
    if ((await recent.count()) > 0) await recent.click();
    // Park the cursor so no card carries a stray hover ring in the shot.
    await page.mouse.move(20, 400);
    await page.waitForTimeout(1100);
    await shot(page, '07-new-appointment-service');

    // Pick a service → doctor auto-answers ANY and the flow moves to time;
    // reopen the DOCTOR step via its Change link to capture it.
    const service = page.locator('.kw-flow-service').first();
    if ((await service.count()) > 0) await service.click();
    await page.waitForTimeout(1600);
    await page
      .locator('.kw-flow-done')
      .filter({ hasText: 'Doctor' })
      .getByRole('button', { name: 'Change' })
      .click();
    await page.mouse.move(20, 400);
    await page.waitForTimeout(1600);
    await shot(page, '08-new-appointment-doctor');

    // Back to the TIME step (pick "Any available doctor" again), on a day the
    // seeded roster serves this service.
    await page.locator('.kw-flow-provider').first().click();
    await page.waitForTimeout(800);
    await page.locator('.ant-drawer').getByRole('button', { name: 'Tomorrow' }).click();
    await page.mouse.move(20, 400);
    await page.waitForTimeout(1800);
    await shot(page, '09-new-appointment-time');

    // Pick a slot → REVIEW.
    const slotChip = page.locator('.kw-flow-slot').first();
    if ((await slotChip.count()) > 0) await slotChip.click();
    await page.waitForTimeout(1000);
    const drawerBody = page.locator('.ant-drawer-body').first();
    await drawerBody.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await page.waitForTimeout(400);
    await shot(page, '10-new-appointment-review');
    await context.close();
  }

  // ---- 11 · LIST -------------------------------------------------------------
  {
    const { page, context } = await open(DESKTOP, '/appointments/list');
    await shot(page, '11-list');
    await context.close();
  }

  // ---- 12–13 · ROSTER --------------------------------------------------------
  {
    const { page, context } = await open(DESKTOP, '/appointments/roster');
    // The board is seeded for August 2026; open that month explicitly so the
    // shot is stable whenever it is re-run.
    const monthPicker = page.locator('.kw-roster-toolbar .ant-picker input').first();
    await monthPicker.click();
    await monthPicker.fill('2026-08');
    await monthPicker.press('Enter');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1400);
    await shot(page, '12-roster-month');

    const chip = page
      .locator('.kw-roster-chip')
      .filter({ hasText: /\d{2}:\d{2}/ })
      .first();
    if ((await chip.count()) > 0) {
      await chip.click();
      await page.waitForTimeout(1200);
      await shot(page, '13-roster-cell-editor');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(600);
    }
    await context.close();
  }

  // ---- 14–15 · SERVICES --------------------------------------------------------
  {
    const { page, context } = await open(DESKTOP, '/appointments/services');
    await shot(page, '14-services');
    await page.getByRole('button', { name: 'Edit' }).first().click();
    await page.waitForTimeout(1200);
    await page.locator('.ant-drawer .ant-tabs-tab', { hasText: 'Scheduling' }).first().click();
    await page.waitForTimeout(800);
    await shot(page, '15-service-editor-scheduling');
    await context.close();
  }

  // ---- 16 · BOOKING PAGE — the split builder -----------------------------------
  {
    const { page, context } = await open(DESKTOP, '/appointments/booking-page');
    await shot(page, '16-booking-page-builder');
    await context.close();
  }

  // ---- 17–22 · PUBLIC, MOBILE -----------------------------------------------
  {
    const { page, context } = await open(MOBILE, '/book/uat-clinic', false);
    await shot(page, '17-public-mobile-service');

    await page.getByText('GP Consultation', { exact: false }).first().click();
    await page.waitForTimeout(2500); // the next-available hints land
    await shot(page, '18-public-mobile-doctor');

    await page.getByRole('button', { name: /continue/i }).first().click();
    await page.waitForTimeout(1400);
    await setPublicDate(page, BUSY_ISO);
    await shot(page, '19-public-mobile-time');

    // Book the last slot the engine still has open — a real booking through
    // the real engine, so the review and confirmation are true.
    await page.locator('.kw-public-slots .ant-btn').last().click();
    await page.waitForTimeout(1000);
    await page.getByLabel(/your full name/i).fill('Nur Aina binti Kamal');
    await page.getByLabel(/mobile number/i).fill('0129990011');
    await page.getByRole('button', { name: /review booking/i }).click();
    await page.waitForTimeout(1000);
    await shot(page, '20-public-mobile-review');

    await page.getByRole('button', { name: /confirm appointment/i }).click();
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, '21-public-mobile-confirmation');

    const manage = page.getByRole('link', { name: /manage my appointment/i });
    if ((await manage.count()) > 0) await manage.click();
    else await page.getByRole('button', { name: /manage my appointment/i }).click();
    await page.waitForTimeout(2000);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, '22-public-mobile-manage');
    await context.close();
  }

  await browser.close();
  console.log('done');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
