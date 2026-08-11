import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from 'dotenv';
import { chromium, Page } from 'playwright-core';

config({ path: join(__dirname, '..', '.env') });

// G4.5d5b — the approved screenshots, captured against POPULATED data.
//
// Seed first, then pass the ids the seeder prints:
//   KUWICK_ALLOW_FIXTURES=yes npx tsx prisma/g45d5b-dispensary-check.ts --seed-only
//   npx tsx prisma/g45d5b-dispensary-shots.ts <clinicId> <visitId>
//
// Every shot is of the real workspace with real records behind it. An empty
// state is captured deliberately and labelled as such; nothing else is.
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium';
const API = 'http://localhost:3000';
const WEB = 'http://localhost:5173';
const OUT = join(__dirname, '..', '..', '..', 'docs', 'g45d5b-screenshots');

const DESKTOP = { width: 1440, height: 1000 };
const TABLET = { width: 1024, height: 800 };
const MOBILE = { width: 375, height: 812 };

const CLINIC_ID = process.argv[2];
const VISIT_ID = process.argv[3];

if (!CLINIC_ID || !VISIT_ID) {
  console.error('Usage: npx tsx prisma/g45d5b-dispensary-shots.ts <clinicId> <visitId>');
  process.exit(1);
}

async function login(email: string) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'DevLocal!2026' }),
  });
  const body = (await res.json()) as Record<string, unknown>;
  if (!body.accessToken) throw new Error(`Login failed for ${email}`);
  return body;
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`  ${name}.png`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const front = await login('siti.front@smoke-test-clinic.test');
  const finance = await login('faiz.finance@smoke-test-clinic.test');
  const stock = await login('owner.admin@smoke-test-clinic.test');

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  console.log(`\nG4.5d5b screenshots -> ${OUT}`);
  console.log('='.repeat(70));

  const open = async (
    viewport: { width: number; height: number },
    url: string,
    session: Record<string, unknown> = front,
  ) => {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    await context.addInitScript(
      (a) => localStorage.setItem('kuwick-auth', JSON.stringify({ state: a, version: 0 })),
      {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        staff: session.staff,
        tenant: session.tenant,
      },
    );
    const page = await context.newPage();
    await page.goto(`${WEB}${url}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    return { page, context };
  };

  const board = '/dispensary';
  const patient = `/dispensary?visitId=${VISIT_ID}`;

  /** Opens the label dialog for the first medication card. */
  const openLabel = async (page: Page) => {
    await page.getByRole('button', { name: /^Print label for/ }).first().click();
    await page.waitForTimeout(1500);
  };

  // --- 1–4. The board ----------------------------------------------------
  {
    const { page, context } = await open(DESKTOP, board);
    await shot(page, '01-desktop-dispensary-board-populated');
    const counts = await page.evaluate(() =>
      [...document.querySelectorAll('.kw-status-tag')].map((n) => (n.textContent ?? '').trim()),
    );
    console.log(`  header counts: ${JSON.stringify(counts)}`);
    await context.close();
  }
  {
    const { page, context } = await open(DESKTOP, board);
    await page.getByPlaceholder('Search patient, visit or queue number').fill('KUWICK');
    await shot(page, '02-desktop-board-search-filtered');
    await context.close();
  }
  {
    const { page, context } = await open(DESKTOP, board);
    // antd's Segmented hides a zero-size input behind a label; the label is
    // what a user actually clicks.
    await page.locator('.ant-segmented-item-label', { hasText: 'Stock issue' }).first().click();
    await shot(page, '03-desktop-board-stock-issue-filter');
    await context.close();
  }
  {
    const { page, context } = await open(DESKTOP, patient);
    await shot(page, '04-desktop-split-workspace-patient-selected');
    const panes = await page.evaluate(() => ({
      list: Boolean(document.querySelector('.kw-dispensary-pane-list')),
      detail: Boolean(document.querySelector('.kw-dispensary-pane-detail')),
      listScrollsAlone:
        getComputedStyle(document.querySelector('.kw-dispensary-list-scroll')!).overflowY === 'auto',
    }));
    console.log(`  split: ${JSON.stringify(panes)}`);
    await context.close();
  }

  // --- 5–9. Medication cards and stock states ----------------------------
  {
    const { page, context } = await open(DESKTOP, patient);
    await page.locator('.kw-dispensary-med-card').first().scrollIntoViewIfNeeded();
    await shot(page, '05-desktop-medication-cards');

    const states = await page.evaluate(() =>
      [...document.querySelectorAll('.kw-dispensary-med-card')].map((card) => ({
        stock: card.getAttribute('data-stock-state'),
        status: card.getAttribute('data-status'),
        quantityIsReadOnly: Boolean(card.querySelector('[data-readonly="true"]')),
        hasQuantityInput: card.querySelectorAll('input[type="number"]').length,
      })),
    );
    console.log(`  cards: ${JSON.stringify(states)}`);
    await context.close();
  }
  {
    const { page, context } = await open(DESKTOP, patient);
    const short = page.locator('.kw-dispensary-med-card[data-stock-state="INSUFFICIENT"]').first();
    if (await short.count()) await short.scrollIntoViewIfNeeded();
    await shot(page, '06-desktop-insufficient-stock-card');
    await context.close();
  }
  {
    const { page, context } = await open(DESKTOP, patient);
    await shot(page, '07-desktop-unresolved-supply-mode-notice');
    const notice = await page.locator('.kw-dispensary-unresolved').first().textContent();
    console.log(`  unresolved notice: ${(notice ?? '').slice(0, 90)}`);
    await context.close();
  }
  {
    const { page, context } = await open(DESKTOP, patient);
    await page.getByRole('checkbox', { name: /^Select / }).first().check({ force: true });
    await shot(page, '08-desktop-multi-select-action-footer');
    await context.close();
  }
  {
    const { page, context } = await open(DESKTOP, patient);
    await page.getByRole('button', { name: /^Dispense / }).first().click();
    await page.waitForTimeout(900);
    await shot(page, '09-desktop-dispense-confirmation');
    const modal = await page.evaluate(() => {
      const dialog = document.querySelector('[data-testid="dispense-confirm-modal"]');
      return {
        found: Boolean(dialog),
        showsBeforeAfter: Boolean(document.querySelector('.kw-dispense-after')),
        quantityInputs: document.querySelectorAll('.ant-modal input[type="number"]').length,
      };
    });
    console.log(`  dispense modal: ${JSON.stringify(modal)}`);
    await context.close();
  }
  {
    const { page, context } = await open(DESKTOP, patient);
    const short = page
      .locator('.kw-dispensary-med-card[data-stock-state="INSUFFICIENT"] button', { hasText: 'Dispense' })
      .first();
    if (await short.count()) {
      await short.click();
      await page.waitForTimeout(900);
    }
    await shot(page, '10-desktop-shortage-acknowledgement-required');
    await context.close();
  }

  // --- 11–16. Labels ------------------------------------------------------
  {
    const { page, context } = await open(DESKTOP, patient);
    await openLabel(page);
    await shot(page, '11-desktop-label-preview');

    const label = await page.evaluate(() => {
      const face = document.querySelector('.kw-label') as HTMLElement | null;
      const rect = face?.getBoundingClientRect();
      return {
        faces: document.querySelectorAll('.kw-label').length,
        widthPx: rect ? Math.round(rect.width) : null,
        heightPx: rect ? Math.round(rect.height) : null,
        text: (face?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 160),
      };
    });
    console.log(`  label: ${JSON.stringify(label)}`);
    await context.close();
  }
  {
    const { page, context } = await open(DESKTOP, patient);
    await openLabel(page);
    await page.locator('.ant-radio-button-wrapper', { hasText: /^3$/ }).first().click();
    await page.waitForTimeout(500);
    await shot(page, '12-desktop-label-three-copies');
    const faces = await page.evaluate(() => document.querySelectorAll('.kw-label').length);
    console.log(`  faces rendered: ${faces}`);
    await context.close();
  }
  {
    const { page, context } = await open(DESKTOP, patient);
    await openLabel(page);
    await page.locator('.kw-label-history').scrollIntoViewIfNeeded();
    await shot(page, '13-desktop-label-print-history');
    await context.close();
  }
  {
    const { page, context } = await open(DESKTOP, patient);
    await openLabel(page);
    await shot(page, '14-desktop-label-printing-is-not-dispensing-notice');
    await context.close();
  }
  {
    // The label at print size, on its own, so the typography can be judged.
    const { page, context } = await open(DESKTOP, patient);
    await openLabel(page);
    const face = page.locator('.kw-label').first();
    if (await face.count()) {
      await face.screenshot({ path: join(OUT, '15-label-face-at-print-size.png') });
      console.log('  15-label-face-at-print-size.png');
    }
    await context.close();
  }
  {
    const { page, context } = await open(DESKTOP, patient);
    await openLabel(page);
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(() => document.body.classList.add('kw-printing-labels'));
    await shot(page, '16-print-media-only-the-label-sheet');
    const printed = await page.evaluate(() => {
      const hiddenHeader = getComputedStyle(document.querySelector('.kw-dispensary-header')!).visibility;
      const labelVisible = getComputedStyle(document.querySelector('.kw-label')!).visibility;
      return { hiddenHeader, labelVisible };
    });
    console.log(`  print media: ${JSON.stringify(printed)}`);
    await context.close();
  }

  // --- 17–20. Tablet and mobile ------------------------------------------
  {
    const { page, context } = await open(TABLET, board);
    await shot(page, '17-tablet-board');
    await context.close();
  }
  {
    const { page, context } = await open(TABLET, patient);
    await shot(page, '18-tablet-patient-workspace');
    await context.close();
  }
  {
    const { page, context } = await open(MOBILE, board);
    await shot(page, '19-mobile-waiting-list');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    console.log(`  mobile board horizontal overflow: ${overflow ? 'OVERFLOWS' : 'none'}`);
    await context.close();
  }
  {
    const { page, context } = await open(MOBILE, patient);
    await shot(page, '20-mobile-patient-medications');
    const report = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      backToList: Boolean(
        [...document.querySelectorAll('button')].find((b) =>
          (b.getAttribute('aria-label') ?? '').includes('Back to the waiting list'),
        ),
      ),
      listHidden: !document.querySelector('.kw-dispensary-pane-list'),
    }));
    console.log(`  mobile patient: ${JSON.stringify(report)}`);
    await context.close();
  }
  {
    const { page, context } = await open(MOBILE, patient);
    await page.getByRole('button', { name: /^Dispense / }).first().click();
    await page.waitForTimeout(900);
    await shot(page, '21-mobile-dispense-sheet');
    await context.close();
  }
  {
    const { page, context } = await open(MOBILE, patient);
    await openLabel(page);
    await shot(page, '22-mobile-label-preview');
    await context.close();
  }

  // --- 23–25. Permission and empty states --------------------------------
  {
    const { page, context } = await open(DESKTOP, board, finance);
    await shot(page, '23-desktop-finance-refused');
    const nav = await page.evaluate(() =>
      [...document.querySelectorAll('.ant-menu-horizontal a')].map((a) => (a.textContent ?? '').trim()),
    );
    console.log(`  finance nav: ${JSON.stringify(nav)}`);
    await context.close();
  }
  {
    const { page, context } = await open(DESKTOP, '/queue', front);
    await shot(page, '24-desktop-nav-shows-dispensary');
    await context.close();
  }
  {
    const { page, context } = await open(DESKTOP, '/dispensary?visitId=00000000-0000-0000-0000-000000000000');
    await shot(page, '25-desktop-visit-moved-on');
    await context.close();
  }

  // --- 26–28. The hand-off from the Queue ---------------------------------
  {
    const { page, context } = await open(DESKTOP, '/queue', front);
    const tab = page.getByRole('tab', { name: /Dispensary/ }).first();
    if (await tab.count()) {
      await tab.click();
      await page.waitForTimeout(900);
    }
    await shot(page, '26-desktop-queue-open-in-dispensary');
    const link = await page.evaluate(() => {
      const anchor = [...document.querySelectorAll('a')].find(
        (a) => (a.textContent ?? '').trim() === 'Open in Dispensary',
      );
      return anchor?.getAttribute('href') ?? null;
    });
    console.log(`  queue hand-off link: ${link}`);
    await context.close();
  }
  {
    const { page, context } = await open(DESKTOP, patient, stock);
    await shot(page, '27-desktop-owner-view');
    await context.close();
  }
  {
    const { page, context } = await open(DESKTOP, patient);
    await page.getByRole('button', { name: /Go to Billing Review/ }).first().click();
    await page.waitForTimeout(2000);
    await shot(page, '28-desktop-onward-to-billing-review');
    console.log(`  landed on: ${new URL(page.url()).pathname}`);
    await context.close();
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
