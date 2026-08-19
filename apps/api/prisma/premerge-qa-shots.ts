import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from 'dotenv';
import { chromium, Page, BrowserContext } from 'playwright-core';

config({ path: join(__dirname, '..', '.env') });

// PRE-MERGE QA (§7–§10) — the screenshot evidence set, driven through the
// real UI against the seeded Klinik Hijraa-shaped week (premerge-qa-seed.ts).
//
//   npx tsx prisma/premerge-qa-seed.ts
//   npx tsx prisma/premerge-qa-shots.ts
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium';
const API = 'http://localhost:3000';
const WEB = 'http://localhost:5173';
const OUT = join(__dirname, '..', '..', '..', 'docs', 'premerge-qa-screenshots');

const DESKTOP = { width: 1440, height: 1000 };
const NARROW = { width: 1024, height: 800 };
const MOBILE = { width: 390, height: 844 };

const BUSY = '26 Aug 2026';

async function login(email: string) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: process.env.E2E_PASSWORD ?? 'DevLocal!2026' }),
  });
  const body = (await res.json()) as Record<string, unknown>;
  if (!body.accessToken) throw new Error(`Login failed for ${email}: ${JSON.stringify(body)}`);
  return body;
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`  ${name}.png`);
}

async function setCalendarDate(page: Page, text: string) {
  const picker = page.locator('.kw-calendar-workspace .ant-picker input').first();
  await picker.click();
  await picker.fill(text);
  await picker.press('Enter');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
}

async function pickView(page: Page, label: string) {
  await page.locator('.ant-segmented-item-label', { hasText: label }).first().click();
  await page.waitForTimeout(900);
}

async function filterProvider(page: Page, name: string) {
  const select = page.locator('.ant-select', { has: page.locator('input') }).filter({ hasText: '' }).first();
  // The provider filter is the first multi-select ("All providers").
  const box = page.getByText('All providers', { exact: false }).first();
  await box.click({ force: true }).catch(() => undefined);
  await page.keyboard.type(name.slice(0, 12));
  await page.waitForTimeout(600);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  void select;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const owner = await login('owner@uat.kuwick.invalid');

  // One REAL check-in through the API so the calendar shows CHECKED_IN with
  // a live queue ticket behind it (finds the seeded ARRIVED appointment).
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${owner.accessToken}` };
  const listRes = await fetch(`${API}/appointments?status=ARRIVED`, { headers });
  const arrived = ((await listRes.json()) as { id: string; sourceDetail?: string }[]).filter(
    (a) => a.sourceDetail === 'premerge-qa',
  );
  if (arrived.length > 0) {
    const checkin = await fetch(`${API}/appointments/${arrived[0].id}/arrived`, { method: 'PATCH', headers });
    console.log(`check-in of seeded ARRIVED appointment: ${checkin.status}`);
  }

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  console.log(`\npremerge QA screenshots -> ${OUT}`);

  const open = async (
    viewport: { width: number; height: number },
    url: string,
    authed = true,
  ): Promise<{ page: Page; context: BrowserContext }> => {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    if (authed) {
      await context.addInitScript(
        (a) => localStorage.setItem('kuwick-auth', JSON.stringify({ state: a, version: 0 })),
        { accessToken: owner.accessToken, refreshToken: owner.refreshToken, staff: owner.staff, tenant: owner.tenant },
      );
    }
    const page = await context.newPage();
    await page.goto(`${WEB}${url}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    return { page, context };
  };

  // ── §7 calendar ───────────────────────────────────────────────────────────
  {
    const { page, context } = await open(DESKTOP, '/appointments/calendar');
    await setCalendarDate(page, BUSY);
    await pickView(page, 'Day');
    await shot(page, '01-calendar-day-busy-all-providers');

    await filterProvider(page, 'Nurul Aisyah');
    await shot(page, '02-calendar-day-single-provider');
    await page.reload({ waitUntil: 'networkidle' });

    await setCalendarDate(page, BUSY);
    await pickView(page, 'Week');
    await shot(page, '03-calendar-week-split-and-night-shifts');

    await pickView(page, 'Month');
    await shot(page, '04-calendar-month-overview');
    await context.close();
  }
  {
    const { page, context } = await open(NARROW, '/appointments/calendar');
    await setCalendarDate(page, BUSY);
    await pickView(page, 'Day');
    await shot(page, '05-calendar-day-narrow-1024');
    await context.close();
  }

  // ── the drawer ────────────────────────────────────────────────────────────
  {
    const { page, context } = await open(DESKTOP, '/appointments/calendar');
    await setCalendarDate(page, BUSY);
    await pickView(page, 'Day');
    const event = page.locator('.rbc-event').filter({ hasText: 'Siti' }).first();
    if ((await event.count()) > 0) {
      await event.click();
    } else {
      await page.locator('.rbc-event').first().click();
    }
    await page.waitForTimeout(1200);
    await shot(page, '06-appointment-drawer-detail');
    await context.close();
  }

  // ── §6 roster ────────────────────────────────────────────────────────────
  {
    const { page, context } = await open(DESKTOP, '/appointments/roster');
    // Bring the seeded fortnight (24–31 Aug) into view — the grid scrolls.
    await page.evaluate(() => {
      for (const el of Array.from(document.querySelectorAll('div, table'))) {
        if (el.scrollWidth > el.clientWidth + 50) el.scrollLeft = el.scrollWidth;
      }
    });
    await shot(page, '07-roster-month-all-providers');
    await context.close();
  }

  // ── list, services, booking page ─────────────────────────────────────────
  {
    const { page, context } = await open(DESKTOP, '/appointments/list');
    await shot(page, '08-list-upcoming-with-money');
    const waitlistSeg = page.locator('.ant-segmented-item-label', { hasText: 'Waitlist' }).first();
    if ((await waitlistSeg.count()) > 0) {
      await waitlistSeg.click();
      await page.waitForTimeout(900);
      await shot(page, '09-list-waitlist');
    }
    await context.close();
  }
  {
    const { page, context } = await open(DESKTOP, '/appointments/services');
    await shot(page, '10-services-catalogue');
    await context.close();
  }
  {
    const { page, context } = await open(DESKTOP, '/appointments/booking-page');
    await shot(page, '11-booking-page-settings');
    const sharing = page.locator('.ant-tabs-tab', { hasText: 'Sharing' }).first();
    if ((await sharing.count()) > 0) {
      await sharing.click();
      await page.waitForTimeout(1000);
      await shot(page, '11b-booking-page-sharing-qr');
    }
    await context.close();
  }

  // ── §8 public booking, desktop ───────────────────────────────────────────
  {
    const { page, context } = await open(DESKTOP, '/book/uat-clinic', false);
    await shot(page, '12-public-desktop-services');

    await page.getByText('GP Consultation', { exact: false }).first().click();
    await page.waitForTimeout(1200);
    await shot(page, '13-public-desktop-provider-choice');

    const anyDoctor = page.getByText(/any available doctor/i).first();
    if ((await anyDoctor.count()) > 0) await anyDoctor.click();
    const cont = page.getByRole('button', { name: /continue/i }).first();
    if ((await cont.count()) > 0) await cont.click();
    await page.waitForTimeout(1500);
    const dateInput = page.locator('.ant-picker input').first();
    if ((await dateInput.count()) > 0) {
      await dateInput.click();
      await dateInput.fill('2026-08-26');
      await dateInput.press('Enter');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1500);
    }
    await shot(page, '14-public-desktop-date-and-slots');
    await context.close();
  }

  // ── §8 empty state: a day nobody offers the service ──────────────────────
  {
    const { page, context } = await open(DESKTOP, '/book/uat-clinic', false);
    await page.getByText('Executive Health Screening', { exact: false }).first().click();
    await page.waitForTimeout(1000);
    const anyDoctor = page.getByText(/any available doctor/i).first();
    if ((await anyDoctor.count()) > 0) await anyDoctor.click();
    const cont = page.getByRole('button', { name: /continue/i }).first();
    if ((await cont.count()) > 0) await cont.click();
    await page.waitForTimeout(1200);
    // Sunday 30 Aug: none of the screening-qualified doctors works Sundays.
    const dateInput = page.locator('.ant-picker input').first();
    if ((await dateInput.count()) > 0) {
      await dateInput.click();
      await dateInput.fill('2026-08-30');
      await dateInput.press('Enter');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1200);
    }
    await shot(page, '15-public-desktop-no-availability');
    await context.close();
  }

  // ── §8 mobile ────────────────────────────────────────────────────────────
  {
    const { page, context } = await open(MOBILE, '/book/uat-clinic', false);
    await shot(page, '16-public-mobile-services');
    await page.getByText('Dental Scaling', { exact: false }).first().click();
    await page.waitForTimeout(1200);
    await shot(page, '17-public-mobile-provider-and-deposit');
    await context.close();
  }

  // ── §3/§8 manage page ────────────────────────────────────────────────────
  {
    const token = `qa003${'x'.repeat(38)}`;
    const { page, context } = await open(DESKTOP, `/book/uat-clinic/manage/${token}`, false);
    await shot(page, '18-manage-booking-desktop');
    await context.close();
  }

  await browser.close();
  console.log('done');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
