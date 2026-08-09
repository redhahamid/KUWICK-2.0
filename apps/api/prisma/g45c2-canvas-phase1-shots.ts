import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from 'dotenv';
import { chromium } from 'playwright-core';

config({ path: join(__dirname, '..', '.env') });

/**
 * Kuwick 2.0 Canvas — Phase 1 proof shots.
 *
 * The three-column shell against the real running app, at the widths a clinic
 * actually uses, plus the two fold-down modes and the Flow layout beside it —
 * because "Flow is not broken" is a claim that has to be shown, not asserted.
 *
 *   npx tsx prisma/g45c2-canvas-phase1-shots.ts <patientId>
 */
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium';
const API = 'http://localhost:3000';
const WEB = 'http://localhost:5173';
const OUT = join(__dirname, '..', '..', '..', 'docs', 'kuwick2-canvas-phase1');

const PATIENT_ID = process.argv[2];
if (!PATIENT_ID) {
  console.error('Usage: npx tsx prisma/g45c2-canvas-phase1-shots.ts <patientId>');
  process.exit(1);
}

const VIEWS = [
  { name: '01-three-column-1440x900', width: 1440, height: 900, layout: 'canvas' },
  { name: '02-three-column-1920x1080', width: 1920, height: 1080, layout: 'canvas' },
  { name: '03-two-column-1180', width: 1180, height: 900, layout: 'canvas' },
  { name: '04-stacked-iphone-390', width: 390, height: 844, layout: 'canvas' },
  { name: '05-flow-untouched-1440', width: 1440, height: 900, layout: 'flow' },
];

async function main() {
  await mkdir(OUT, { recursive: true });
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner.admin@smoke-test-clinic.test', password: 'DevLocal!2026' }),
  });
  const owner = (await res.json()) as Record<string, unknown>;
  if (!owner.accessToken) throw new Error(`Login failed: ${JSON.stringify(owner)}`);

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  console.log(`\nKuwick 2.0 Canvas — Phase 1 -> ${OUT}`);
  console.log('='.repeat(70));

  for (const view of VIEWS) {
    const context = await browser.newContext({
      viewport: { width: view.width, height: view.height },
      deviceScaleFactor: 2,
      isMobile: view.width < 500,
      hasTouch: view.width < 500,
    });
    await context.addInitScript(
      (a) => localStorage.setItem('kuwick-auth', JSON.stringify({ state: a, version: 0 })),
      {
        accessToken: owner.accessToken,
        refreshToken: owner.refreshToken,
        staff: owner.staff,
        tenant: owner.tenant,
      },
    );
    // The layout preference is now per staff member, so seed it under the
    // signed-in staff id rather than as one shared value.
    await context.addInitScript(
      (payload) =>
        localStorage.setItem(
          'kuwick-record-view-layout-v2',
          JSON.stringify({
            state: { byStaffId: { [payload.staffId]: payload.layout }, anonymous: payload.layout },
            version: 0,
          }),
        ),
      { staffId: (owner.staff as { id: string }).id, layout: view.layout },
    );

    const page = await context.newPage();
    await page.goto(`${WEB}/patients/${PATIENT_ID}`, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(2000);
    const visitRow = page.locator('.ant-list-item, .ant-table-row, [data-visit-id]').first();
    if (await visitRow.count()) await visitRow.click().catch(() => {});
    await page.waitForTimeout(2500);

    await page.screenshot({ path: join(OUT, `${view.name}.png`), fullPage: view.width < 500 });

    const measured = await page.evaluate(() => {
      // No inner function declarations: the TypeScript runner rewrites them
      // with a `__name` helper that does not exist inside the browser.
      const shell = document.querySelector('.kw-canvas2-shell');
      const widths: Record<string, number | null> = {};
      for (const sel of ['.kw-canvas2-visits', '.kw-canvas2-middle', '.kw-canvas2-right']) {
        const el = document.querySelector(sel);
        widths[sel] = el ? Math.round(el.getBoundingClientRect().width) : null;
      }
      return {
        mode: shell ? (shell.getAttribute('data-mode') ?? '?') : 'no canvas shell (Flow)',
        visits: widths['.kw-canvas2-visits'],
        middle: widths['.kw-canvas2-middle'],
        right: widths['.kw-canvas2-right'],
        docScrollWidth: document.documentElement.scrollWidth,
      };
    });
    console.log(
      `  ${view.name}.png  mode=${measured.mode}  ` +
        `cols=${measured.visits}/${measured.middle}/${measured.right}  ` +
        `doc=${measured.docScrollWidth} vs ${view.width}`,
    );
    await context.close();
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
