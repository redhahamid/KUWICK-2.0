/**
 * THE PATIENT BOOKING ACCEPTANCE PACK — reproducible, from the built app.
 *
 * Seven phone shots walking the whole journey, three desktop, plus the two
 * surfaces a patient meets after booking (manage, reschedule) and the proof
 * that a service with one qualified provider skips the doctor step entirely.
 *
 * Run against the local stack (api :3000, `vite preview` :5173) with the
 * premerge QA seed loaded — the clinic is "Klinik Hijraa Bangi", GP
 * Consultation has six qualified doctors and Density Follow-up Review has
 * exactly one, which is what makes both paths capturable.
 *
 *   node shots-booking.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173';
const OUT = process.env.OUT ?? 'docs/patient-booking-screenshots';
const PHONE = { width: 390, height: 844 };
const DESK = { width: 1440, height: 900 };
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium',
});

/**
 * Parks the pointer in the corner first. Playwright leaves the virtual mouse
 * wherever it last clicked, so the row that happens to sit under that
 * coordinate on the NEXT step renders hovered — which in a still image reads
 * as a second selected row.
 */
const shoot = async (page, name) => {
  await page.mouse.move(2, 2);
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log(name);
};

async function open(viewport, mobile) {
  const page = await browser.newPage({
    viewport,
    deviceScaleFactor: 2,
    isMobile: mobile,
    hasTouch: mobile,
  });
  await page.goto(`${BASE}/book/uat-clinic`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1600);
  return page;
}

/** Fills the patient's own details — a plausible Malaysian record, never a real one. */
async function fillDetails(page) {
  await page.getByLabel('Your full name').fill('Siti Aminah binti Rahman');
  await page.getByLabel('Mobile number').fill('012-345 6789');
  const ic = page.getByLabel('IC or passport number');
  if (await ic.count()) await ic.fill('900101-14-5566');
  const reason = page.getByLabel('What would you like to be seen about?');
  if (await reason.count()) await reason.fill('Persistent cough for five days, worse at night.');
}

// ---- PHONE: the whole journey, GP Consultation (six doctors) --------------
const m = await open(PHONE, true);
await shoot(m, 'm1-service');

await m.locator('.kw-public-service').filter({ hasText: 'GP Consultation' }).first().click();
await m.waitForTimeout(2000);
await shoot(m, 'm2-doctor');

await m.locator('.kw-public-provider').nth(1).click();
await m.waitForTimeout(400);
await m.getByRole('button', { name: /^Continue$/ }).first().click();
await m.waitForTimeout(2000);
await shoot(m, 'm3-date');

await m.locator('.kw-avcal-day:not([disabled])').first().click();
await m.waitForTimeout(2000);
await m.locator('.kw-public-slots button').first().click();
await m.waitForTimeout(700);
await shoot(m, 'm4-time');

await m.getByTestId('continue-to-details').click();
await m.waitForTimeout(1300);
await fillDetails(m);
await shoot(m, 'm5-details');

await m.getByRole('button', { name: /Review booking/i }).click();
await m.waitForTimeout(1300);
await shoot(m, 'm6-review');

await m.getByRole('button', { name: /Confirm appointment/i }).click();
await m.waitForTimeout(3000);
await shoot(m, 'm7-confirmed');

const manageHref = await m.evaluate(() => {
  const el = [...document.querySelectorAll('a')].find((n) =>
    /Manage my appointment/i.test(n.textContent || ''),
  );
  return el?.getAttribute('href') ?? null;
});
await m.goto(`${BASE}${manageHref}`, { waitUntil: 'networkidle' });
await m.waitForTimeout(1800);
await shoot(m, 'm8-manage');

await m.getByRole('button', { name: /change the time/i }).first().click();
await m.waitForTimeout(2200);
await shoot(m, 'm9-reschedule');
await m.close();

// ---- PHONE: the doctor step that answers itself ---------------------------
const s = await open(PHONE, true);
await s.locator('.kw-public-service').filter({ hasText: 'Density Follow-up' }).first().click();
await s.waitForTimeout(2200);
await shoot(s, 'm10-sole-provider-skips-to-date');
await s.close();

// ---- DESKTOP -------------------------------------------------------------
const d = await open(DESK, false);
await shoot(d, 'd1-service');
await d.locator('.kw-public-service').filter({ hasText: 'GP Consultation' }).first().click();
await d.waitForTimeout(2000);
await shoot(d, 'd2-doctor');
await d.locator('.kw-public-provider').nth(1).click();
await d.waitForTimeout(400);
await d.getByRole('button', { name: /^Continue$/ }).first().click();
await d.waitForTimeout(2000);
await d.locator('.kw-avcal-day:not([disabled])').first().click();
await d.waitForTimeout(2000);
await d.locator('.kw-public-slots button').first().click();
await d.waitForTimeout(600);
await d.getByTestId('continue-to-details').click();
await d.waitForTimeout(1300);
await fillDetails(d);
await d.getByRole('button', { name: /Review booking/i }).click();
await d.waitForTimeout(1300);
await shoot(d, 'd3-review');
await d.close();

await browser.close();
