import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from 'dotenv';
import { chromium, Page } from 'playwright-core';

config({ path: join(__dirname, '..', '.env') });

// G4.5d3c-3b2 (D-094) — the sixteen approved Billing Review screenshots.
//
// Run the seeder first so the fixtures exist:
//   KUWICK_ALLOW_FIXTURES=yes npx tsx prisma/g45d3c3b2-billing-review-check.ts --seed-only
//   npx tsx prisma/g45d3c3b2-billing-review-shots.ts
//
// Every shot is of a POPULATED workspace against the running API — no empty
// fixtures, no mocked screens.
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium';
const API = 'http://localhost:3000';
const WEB = 'http://localhost:5173';
const OUT = join(__dirname, '..', '..', '..', 'docs', 'g45d3c3b2-screenshots');

const DESKTOP = { width: 1440, height: 1000 };
const TABLET = { width: 834, height: 1112 };
const MOBILE = { width: 375, height: 812 };

// Populated by --seed-only; passed in via argv so the shots never guess.
const CASH_VISIT = process.argv[2];
const PANEL_VISIT = process.argv[3];
const OTC_VISIT = process.argv[4];

async function login(email: string) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'DevLocal!2026' }),
  });
  const body = (await res.json()) as Record<string, unknown>;
  if (!body.accessToken) throw new Error(`Login failed for ${email}: ${JSON.stringify(body)}`);
  return body;
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });
  console.log(`  ${name}.png`);
}

async function main() {
  if (!CASH_VISIT || !PANEL_VISIT || !OTC_VISIT) {
    throw new Error('Usage: npx tsx prisma/g45d3c3b2-billing-review-shots.ts <cashVisitId> <panelVisitId> <otcVisitId>');
  }
  await mkdir(OUT, { recursive: true });
  const frontDesk = await login('siti.front@smoke-test-clinic.test');
  const finance = await login('faiz.finance@smoke-test-clinic.test');

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  console.log(`\nG4.5d3c-3b2 screenshots -> ${OUT}`);
  console.log('='.repeat(70));

  const openAs = async (auth: Record<string, unknown>, viewport: { width: number; height: number }, url: string) => {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    await context.addInitScript(
      (a) => localStorage.setItem('kuwick-auth', JSON.stringify({ state: a, version: 0 })),
      { accessToken: auth.accessToken, refreshToken: auth.refreshToken, staff: auth.staff, tenant: auth.tenant },
    );
    const page = await context.newPage();
    await page.goto(`${WEB}${url}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    return { page, context };
  };

  // 1. Desktop Billing Review with a mixed worklist.
  {
    const { page, context } = await openAs(frontDesk, DESKTOP, `/billing/visits/${CASH_VISIT}`);
    await shot(page, '01-desktop-billing-review-mixed-worklist');

    // 3. The auto-added cash consultation line, at the top of the invoice.
    await page.evaluate(() => document.querySelector('.ant-table')?.scrollIntoView({ block: 'start' }));
    await shot(page, '03-desktop-auto-added-cash-consultation');

    // 2. Active invoice and the responsibility summary together.
    await page.evaluate(() => window.scrollTo(0, 560));
    await shot(page, '02-desktop-invoice-and-responsibility-summary');

    // 9. Multiple actionable blockers.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await shot(page, '09-desktop-multiple-actionable-blockers');
    await context.close();
  }

  // 4. Panel-specific consultation tariff (AIA RM20, not the RM35 cash price).
  // 7. Panel verification / benefit section.
  {
    const { page, context } = await openAs(frontDesk, DESKTOP, `/billing/visits/${PANEL_VISIT}`);
    await shot(page, '04-desktop-panel-specific-consultation-tariff');
    await page.getByRole('button', { name: /record verification/i }).click();
    await page.waitForTimeout(600);
    await shot(page, '07-desktop-panel-verification-benefit-section');
    await page.keyboard.press('Escape');
    await context.close();
  }

  // 5. Consultation tariff review blocker — an exempt visit reclassified so
  //    no band covers it is the honest way to show the review state.
  {
    const { page, context } = await openAs(frontDesk, DESKTOP, `/billing/visits/${OTC_VISIT}`);
    await shot(page, '05-desktop-consultation-exempt-and-tariff-review');
    await context.close();
  }

  // 6. Consultation waiver confirmation (front desk, reason mandatory).
  {
    const { page, context } = await openAs(frontDesk, DESKTOP, `/billing/visits/${CASH_VISIT}`);
    await page.getByRole('button', { name: /^waive$/i }).first().click();
    await page.waitForTimeout(700);
    await shot(page, '06-desktop-consultation-waiver-confirmation');
    await context.close();
  }

  // 8. Finance discount entry, with the calculated amount shown first.
  {
    const { page, context } = await openAs(finance, DESKTOP, `/billing/visits/${CASH_VISIT}`);
    await page.getByRole('button', { name: /overall discount/i }).click();
    await page.waitForTimeout(500);
    await page.getByRole('spinbutton', { name: /value/i }).fill('10');
    await page.getByRole('textbox', { name: /reason/i }).fill('Staff family rate');
    await page.waitForTimeout(400);
    await shot(page, '08-desktop-finance-discount-entry');
    await context.close();
  }

  // 10. Zero-patient-balance PANEL settlement state.
  {
    const { page, context } = await openAs(frontDesk, DESKTOP, `/billing/visits/${PANEL_VISIT}`);
    await page.evaluate(() => window.scrollTo(0, 400));
    await shot(page, '10-desktop-panel-no-patient-payment-state');
    await context.close();
  }

  // 11. Completed patient payment state.
  {
    const { page, context } = await openAs(frontDesk, DESKTOP, `/billing/visits/${CASH_VISIT}`);
    await page.evaluate(() => window.scrollTo(0, 400));
    await shot(page, '11-desktop-completed-patient-payment');
    await context.close();
  }

  // 12. Tablet.
  {
    const { page, context } = await openAs(frontDesk, TABLET, `/billing/visits/${CASH_VISIT}`);
    await shot(page, '12-tablet-billing-review');
    await context.close();
  }

  // 13/14/15/16. Mobile.
  {
    const { page, context } = await openAs(frontDesk, MOBILE, `/billing/visits/${CASH_VISIT}`);
    await shot(page, '13-mobile-worklist');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.55));
    await shot(page, '14-mobile-invoice-summary');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('button', { name: /^waive$/i }).first().click();
    await page.waitForTimeout(700);
    await shot(page, '16-mobile-consultation-waiver-modal');
    await page.keyboard.press('Escape');
    await context.close();
  }
  {
    const { page, context } = await openAs(frontDesk, MOBILE, `/billing/visits/${PANEL_VISIT}`);
    await page.getByRole('button', { name: /record verification/i }).click();
    await page.waitForTimeout(700);
    await shot(page, '15-mobile-benefit-modal');
    await context.close();
  }

  // Bonus: the configuration screen the tariff blocker points at.
  {
    const { page, context } = await openAs(finance, DESKTOP, '/settings/clinical/consultation-tariffs');
    await shot(page, '17-desktop-consultation-tariff-configuration');
    const { page: mobilePage, context: mobileContext } = await openAs(
      finance,
      MOBILE,
      '/settings/clinical/consultation-tariffs',
    );
    await shot(mobilePage, '18-mobile-consultation-tariff-configuration');
    await context.close();
    await mobileContext.close();
  }

  // Horizontal-overflow check at every width — a workspace that scrolls
  // sideways is a defect, not a screenshot caption.
  console.log('\nHORIZONTAL OVERFLOW');
  for (const [name, viewport] of [['desktop', DESKTOP], ['tablet', TABLET], ['mobile', MOBILE]] as const) {
    const { page, context } = await openAs(frontDesk, viewport, `/billing/visits/${CASH_VISIT}`);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    console.log(`  ${name.padEnd(8)} ${overflow ? 'OVERFLOWS' : 'no overflow'}`);
    await context.close();
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
