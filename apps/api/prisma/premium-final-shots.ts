import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from 'dotenv';
import { chromium, Page, BrowserContext } from 'playwright-core';

config({ path: join(__dirname, '..', '.env') });

// §35 — THE FINAL 22. Captured after the premium pass, against the seeded
// Klinik Hijraa-shaped week, through the real UI.
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium';
const API = 'http://localhost:3000';
const WEB = 'http://localhost:5173';
const OUT = join(__dirname, '..', '..', '..', 'docs', 'final-product-screenshots');

const DESKTOP = { width: 1440, height: 1000 };
const MOBILE = { width: 390, height: 844 };
const BUSY = '26 Aug 2026';

async function login() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner@uat.kuwick.invalid', password: process.env.E2E_PASSWORD ?? 'DevLocal!2026' }),
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

async function main() {
  await mkdir(OUT, { recursive: true });
  const owner = await login();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  console.log(`final screenshots -> ${OUT}`);

  const open = async (viewport: { width: number; height: number }, url: string, authed = true): Promise<{ page: Page; context: BrowserContext }> => {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    if (authed) {
      await context.addInitScript(
        (a) => localStorage.setItem('kuwick-auth', JSON.stringify({ state: a, version: 0 })),
        { accessToken: owner.accessToken, refreshToken: owner.refreshToken, staff: owner.staff, tenant: owner.tenant },
      );
    }
    const page = await context.newPage();
    await page.goto(`${WEB}${url}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1400);
    return { page, context };
  };

  // 1–4 calendar views
  {
    const { page, context } = await open(DESKTOP, '/appointments/calendar');
    await setCalDate(page, BUSY);
    await seg(page, 'Day');
    await shot(page, '01-calendar-day');
    await seg(page, 'Week');
    await shot(page, '02-calendar-week');
    await seg(page, 'Month');
    await shot(page, '03-calendar-month');
    await seg(page, 'Providers');
    await shot(page, '04-calendar-providers');

    // 5 drawer
    await seg(page, 'Day');
    const chip = page.locator('.rbc-event').filter({ hasText: 'Kavitha' }).first();
    if ((await chip.count()) > 0) await chip.click();
    else await page.locator('.rbc-event').first().click();
    await page.waitForTimeout(1300);
    await shot(page, '05-appointment-drawer');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // 6 new appointment
    await page.getByRole('button', { name: /new appointment/i }).click();
    await page.waitForTimeout(1300);
    await shot(page, '06-new-appointment');
    await context.close();
  }

  // 7 list
  {
    const { page, context } = await open(DESKTOP, '/appointments/list');
    await shot(page, '07-list');
    await context.close();
  }

  // 8–9 roster
  {
    const { page, context } = await open(DESKTOP, '/appointments/roster');
    await page.evaluate(() => {
      for (const el of Array.from(document.querySelectorAll('div, table'))) {
        if (el.scrollWidth > el.clientWidth + 50) el.scrollLeft = el.scrollWidth;
      }
    });
    await shot(page, '08-roster-monthly');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(600);
    await shot(page, '09-fixed-weekly-collapsed');
    await context.close();
  }

  // 10–12 services + editor
  {
    const { page, context } = await open(DESKTOP, '/appointments/services');
    await shot(page, '10-services-list');
    await page.getByRole('button', { name: 'Edit' }).first().click();
    await page.waitForTimeout(1200);
    const tab = async (label: string) => {
      await page.locator('.ant-drawer .ant-tabs-tab', { hasText: label }).first().click();
      await page.waitForTimeout(800);
    };
    await tab('Scheduling');
    await shot(page, '11-service-scheduling');
    await tab('Providers');
    await shot(page, '12-service-providers');
    await context.close();
  }

  // 13–14 booking page settings
  {
    const { page, context } = await open(DESKTOP, '/appointments/booking-page');
    await shot(page, '13-booking-page-general');
    await page.locator('.ant-tabs-tab', { hasText: 'Sharing' }).first().click();
    await page.waitForTimeout(1000);
    await shot(page, '14-booking-page-sharing');
    await context.close();
  }

  // 15 public services desktop / 16 mobile
  {
    const { page, context } = await open(DESKTOP, '/book/uat-clinic', false);
    await shot(page, '15-public-services-desktop');
    await context.close();
  }
  {
    const { page, context } = await open(MOBILE, '/book/uat-clinic', false);
    await shot(page, '16-public-services-mobile');

    // 17 provider selection (mobile — the storefront's native shape)
    await page.getByText('GP Consultation', { exact: false }).first().click();
    await page.waitForTimeout(1200);
    await shot(page, '17-public-provider-selection');

    // 18 time selection on the busy day
    await page.getByRole('button', { name: /continue/i }).first().click();
    await page.waitForTimeout(1400);
    const dateInput = page.locator('.ant-picker input').first();
    await dateInput.click();
    await dateInput.fill('2026-08-26');
    await dateInput.press('Enter');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1600);
    await shot(page, '18-public-time-selection');

    // 19 no-availability with next-available CTA (today is inside min-notice)
    await dateInput.click();
    const today = new Date().toISOString().slice(0, 10);
    await dateInput.fill(today);
    await dateInput.press('Enter');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(4500); // give the forward probe time to land
    await shot(page, '19-public-no-availability');

    // back to the busy day; pick a slot late in the evening (kept free)
    await dateInput.click();
    await dateInput.fill('2026-08-26');
    await dateInput.press('Enter');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1600);
    const slotButton = page.locator('.kw-public-slots .ant-btn', { hasText: '23:45' }).first();
    if ((await slotButton.count()) > 0) await slotButton.click();
    else await page.locator('.kw-public-slots .ant-btn').last().click();
    await page.waitForTimeout(1200);

    // 20 patient details
    await page.getByLabel(/your full name/i).fill('Nur Aina binti Kamal');
    await page.getByLabel(/mobile number/i).fill('0129990011');
    await shot(page, '20-public-patient-details');

    // 21 confirmation — a real booking through the real engine
    await page.getByRole('button', { name: /confirm appointment/i }).click();
    await page.waitForTimeout(2500);
    await shot(page, '21-public-confirmation');

    // 22 manage page via the link on the confirmation
    const manage = page.getByRole('button', { name: /manage my appointment/i });
    if ((await manage.count()) > 0) {
      await manage.click();
    } else {
      await page.getByRole('link', { name: /manage my appointment/i }).click();
    }
    await page.waitForTimeout(2000);
    await shot(page, '22-manage-booking');
    await context.close();
  }

  await browser.close();
  console.log('done');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
