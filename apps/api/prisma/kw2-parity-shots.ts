import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from 'dotenv';
import { chromium, Page } from 'playwright-core';

config({ path: join(__dirname, '..', '.env') });

/**
 * Kuwick 2.0 Canvas — parity screenshot set.
 *
 * The owner reviews against the approved mockup, so the reference width is
 * the CONTAINER, not the viewport: the shell sits inside an app header and
 * page padding, so a 1600px container needs a wider window. This measures the
 * container and reports it, rather than assuming the two are the same.
 *
 *   npx tsx prisma/kw2-parity-shots.ts <patientId> <phaseDir>
 */
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium';
const API = 'http://localhost:3000';
const WEB = 'http://localhost:5173';

const PATIENT_ID = process.argv[2];
const PHASE_DIR = process.argv[3] ?? 'kuwick2-canvas-phase1';
const OUT = join(__dirname, '..', '..', '..', 'docs', PHASE_DIR);

if (!PATIENT_ID) {
  console.error('Usage: npx tsx prisma/kw2-parity-shots.ts <patientId> [phaseDir]');
  process.exit(1);
}

/** Page padding either side of the shell, so a 1600 CONTAINER is reachable. */
const CHROME_PADDING = 64;

async function main() {
  await mkdir(OUT, { recursive: true });
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner.admin@smoke-test-clinic.test', password: 'DevLocal!2026' }),
  });
  const owner = (await res.json()) as Record<string, unknown>;
  if (!owner.accessToken) throw new Error(`Login failed: ${JSON.stringify(owner)}`);
  const staffId = (owner.staff as { id: string }).id;

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  console.log(`\nKuwick 2.0 Canvas — parity set -> ${OUT}`);
  console.log('='.repeat(72));

  const open = async (width: number, height: number, layout = 'canvas') => {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 2,
      isMobile: width < 500,
      hasTouch: width < 500,
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
    await context.addInitScript(
      (p) =>
        localStorage.setItem(
          'kuwick-record-view-layout-v2',
          JSON.stringify({
            state: { byStaffId: { [p.staffId]: p.layout }, anonymous: p.layout },
            version: 0,
          }),
        ),
      { staffId, layout },
    );
    const page = await context.newPage();
    await page.goto(`${WEB}/patients/${PATIENT_ID}`, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(2000);
    const row = page.locator('.ant-list-item, .ant-table-row, [data-visit-id]').first();
    if (await row.count()) await row.click().catch(() => {});
    await page.waitForTimeout(2500);
    return { page, context };
  };

  const measure = (page: Page) =>
    page.evaluate(() => {
      const shell = document.querySelector('.kw-canvas2-shell');
      const widths: Record<string, number | null> = {};
      for (const sel of ['.kw-canvas2-visits', '.kw-canvas2-middle', '.kw-canvas2-right']) {
        const el = document.querySelector(sel);
        widths[sel] = el ? Math.round(el.getBoundingClientRect().width) : null;
      }
      return {
        container: shell ? Math.round(shell.getBoundingClientRect().width) : null,
        mode: shell ? (shell.getAttribute('data-mode') ?? '?') : 'no shell (Flow)',
        visits: widths['.kw-canvas2-visits'],
        middle: widths['.kw-canvas2-middle'],
        right: widths['.kw-canvas2-right'],
        docWidth: document.documentElement.scrollWidth,
      };
    });

  /** Box of a selector, for cropping the built area out of the full shot. */
  const boxOf = async (page: Page, selector: string) =>
    page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    }, selector);

  // --- 1. The reference view: 1600px CONTAINER --------------------------
  {
    const { page, context } = await open(1600 + CHROME_PADDING, 1100);
    const m = await measure(page);
    await page.screenshot({ path: join(OUT, 'p1-01-full-canvas-1600.png') });
    console.log(
      `  p1-01-full-canvas-1600.png  container=${m.container} mode=${m.mode} ` +
        `cols=${m.visits}/${m.middle}/${m.right}  doc=${m.docWidth}`,
    );

    // The built area: the three-column shell itself.
    const shell = await boxOf(page, '.kw-canvas2-shell');
    if (shell) {
      await page.screenshot({
        path: join(OUT, 'p1-02-built-three-columns.png'),
        clip: { ...shell, height: Math.min(shell.height, 760) },
      });
      console.log(`  p1-02-built-three-columns.png  clip=${JSON.stringify(shell)}`);
    }

    // The visits rail on its own — Phase 1's only new content column.
    const rail = await boxOf(page, '.kw-canvas2-visits');
    if (rail) {
      await page.screenshot({
        path: join(OUT, 'p1-03-built-visits-rail.png'),
        clip: { ...rail, height: Math.min(rail.height, 560) },
      });
      console.log(`  p1-03-built-visits-rail.png  clip=${JSON.stringify(rail)}`);
    }

    // The header band area — where LAST VISIT used to sit (parity fix A).
    const band = await boxOf(page, '.kw-visit-band');
    if (band) {
      await page.screenshot({
        path: join(OUT, 'p1-04-header-band-after-retiring-last-visit.png'),
        clip: { x: 0, y: Math.max(0, band.y - 120), width: 1600 + CHROME_PADDING, height: band.height + 150 },
      });
      console.log(`  p1-04-header-band-after-retiring-last-visit.png`);
    }
    await context.close();
  }

  // --- 2. Layout thumbnails ---------------------------------------------
  {
    const { page, context } = await open(1180, 900);
    const tab = page.locator('[data-testid="canvas-history-tab"]');
    if (await tab.count()) await tab.click().catch(() => {});
    await page.waitForTimeout(900);
    const m = await measure(page);
    await page.screenshot({ path: join(OUT, 'p1-05-thumb-1180-history-drawer.png') });
    console.log(`  p1-05-thumb-1180-history-drawer.png  mode=${m.mode} doc=${m.docWidth}`);
    await context.close();
  }
  {
    const { page, context } = await open(390, 844);
    const m = await measure(page);
    await page.screenshot({ path: join(OUT, 'p1-06-thumb-390-stacked.png'), fullPage: true });
    console.log(`  p1-06-thumb-390-stacked.png  mode=${m.mode} doc=${m.docWidth}`);
    await context.close();
  }
  {
    const { page, context } = await open(1600 + CHROME_PADDING, 1100, 'flow');
    const m = await measure(page);
    await page.screenshot({ path: join(OUT, 'p1-07-thumb-flow-untouched.png') });
    console.log(`  p1-07-thumb-flow-untouched.png  mode=${m.mode} doc=${m.docWidth}`);
    await context.close();
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
