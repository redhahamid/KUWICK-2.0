import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from 'dotenv';
import { chromium, Page } from 'playwright-core';

config({ path: join(__dirname, '..', '.env') });

/**
 * Kuwick 2.0 Canvas — PHASE 2 (second half) parity set.
 *
 * Copy Rx in all three allergy states, the past-visit hover preview, and Hold
 * in both directions — captured against the RUNNING app at the 1600px
 * CONTAINER width the owner reviews at.
 *
 * SYNTHETIC DATA ONLY. It drives the smoke-test clinic's own fixture patient
 * and puts the allergy field back the way it found it.
 *
 *   npx tsx prisma/kw2-parity-shots-2b.ts
 */
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium';
const API = 'http://localhost:3000';
const WEB = 'http://localhost:5173';
const OUT = join(__dirname, '..', '..', '..', 'docs', 'kuwick2-canvas-phase2b');

/** Page padding either side of the shell, so a 1600 CONTAINER is reachable. */
const CHROME_PADDING = 64;

const PATIENT = '26a75e53-21b8-40ef-a306-2ffce83b67f4';
/** Newest visit — its rail carries the documented one as a PAST card. */
const LATEST_VISIT = 'dd25871c-5617-4b3c-824f-fd4cb10225df';
/** The visit with a SIGNED note, an Rx and a live IN_CONSULTATION ticket. */
const DOCUMENTED_VISIT = '25945379-88e3-4c9b-b6fa-d53df7c25658';

async function main() {
  await mkdir(OUT, { recursive: true });

  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner.admin@smoke-test-clinic.test', password: 'DevLocal!2026' }),
  });
  const owner = (await res.json()) as Record<string, unknown>;
  if (!owner.accessToken) throw new Error(`Login failed: ${JSON.stringify(owner)}`);
  const token = owner.accessToken as string;
  const staffId = (owner.staff as { id: string }).id;
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const patientBefore = (await (await fetch(`${API}/patients/${PATIENT}`, { headers: auth })).json()) as {
    allergies: string[] | null;
  };
  const setAllergies = async (allergies: string[] | null) => {
    await fetch(`${API}/patients/${PATIENT}`, {
      method: 'PATCH',
      headers: auth,
      body: JSON.stringify({ allergies }),
    });
  };

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  console.log(`\nKuwick 2.0 Canvas — phase 2b parity set -> ${OUT}`);
  console.log('='.repeat(72));

  const open = async (width: number, height: number, visitId?: string, path = `/patients/${PATIENT}`) => {
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
            state: { byStaffId: { [p.staffId]: 'canvas' }, anonymous: 'canvas' },
            version: 0,
          }),
        ),
      { staffId },
    );
    const page = await context.newPage();
    const url = visitId ? `${WEB}${path}?visitId=${visitId}` : `${WEB}${path}`;
    await page.goto(url, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(2600);
    return { page, context };
  };

  const boxOf = async (page: Page, selector: string) =>
    page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: Math.max(0, Math.round(r.x) - 8),
        y: Math.max(0, Math.round(r.y) - 8),
        width: Math.round(r.width) + 16,
        height: Math.round(r.height) + 16,
      };
    }, selector);

  const shot = async (page: Page, file: string, selector?: string, maxHeight = 900) => {
    const clip = selector ? await boxOf(page, selector) : null;
    await page.screenshot({
      path: join(OUT, file),
      ...(clip ? { clip: { ...clip, height: Math.min(clip.height, maxHeight) } } : {}),
    });
    console.log(`  ${file}${clip ? `  clip=${clip.width}x${Math.min(clip.height, maxHeight)}` : ''}`);
  };

  const W = 1600 + CHROME_PADDING;

  // === 1. Full canvas, and the hover preview ==============================
  {
    const { page, context } = await open(W, 1100, LATEST_VISIT);
    const container = await page.evaluate(() => {
      const el = document.querySelector('.kw-canvas2-shell');
      return el ? Math.round(el.getBoundingClientRect().width) : null;
    });
    console.log(`  container=${container}px`);
    await shot(page, 'p2b-01-full-canvas-1600.png');

    // Hover the documented past visit. The intent delay is real, so the wait
    // has to be longer than it is — that IS the behaviour being captured.
    // The SECOND past card — the one carrying a signed doctor narrative. The
    // first has no note, and "no clinical note recorded" is a state worth
    // capturing separately rather than the one that shows the feature.
    const cards = page.locator('[data-testid="canvas-visit-past"]');
    await cards.nth(1).hover();
    await page.waitForTimeout(1400);
    const previewVisible = await page.locator('[data-testid="canvas-visit-preview"]').count();
    console.log(`  hover preview present=${previewVisible > 0}`);
    // Wide enough to hold the rail AND the panel, which opens to its right.
    const rail = await boxOf(page, '.kw-canvas2-visits');
    if (rail) {
      await page.screenshot({
        path: join(OUT, 'p2b-02-hover-preview.png'),
        clip: { ...rail, width: rail.width + 360, height: Math.min(rail.height, 700) },
      });
      console.log(`  p2b-02-hover-preview.png  clip=${rail.width + 360}x${Math.min(rail.height, 700)}`);
    }

    // The honest absence, on a visit that carries no note at all.
    await cards.nth(0).hover();
    await page.waitForTimeout(1400);
    if (rail) {
      await page.screenshot({
        path: join(OUT, 'p2b-02b-hover-preview-no-note.png'),
        clip: { ...rail, width: rail.width + 360, height: Math.min(rail.height, 700) },
      });
      console.log(`  p2b-02b-hover-preview-no-note.png`);
    }
    await context.close();
  }

  // === 2. Copy Rx, in all three allergy states ============================
  const copyRxShot = async (file: string, allergies: string[] | null, note: string) => {
    await setAllergies(allergies);
    const { page, context } = await open(W, 1100, LATEST_VISIT);
    // The Ibuprofen visit, so the name-match rule has something to match on.
    const button = page
      .locator('[data-testid="canvas-visit-past"]')
      .nth(1)
      .locator('button', { hasText: 'Copy Rx' });
    if (!(await button.count())) {
      console.log(`  !! ${file}: no Copy Rx control on any past visit`);
      await context.close();
      return;
    }
    await button.click();
    await page.waitForTimeout(1600);
    await shot(page, file, '.ant-modal', 900);
    console.log(`     (${note})`);
    await context.close();
  };

  await copyRxShot('p2b-03-copyrx-allergy-match.png', ['Ibuprofen'], 'amber, name matched, still selectable');
  await copyRxShot('p2b-04-copyrx-none-known.png', [], 'asked and none known');
  await copyRxShot('p2b-05-copyrx-no-record.png', null, 'never asked — absence is its own warning');
  await setAllergies(patientBefore.allergies);
  console.log(`  allergies restored to ${JSON.stringify(patientBefore.allergies)}`);

  // === 3. Hold, in both states ===========================================
  {
    const { page, context } = await open(W, 1100, DOCUMENTED_VISIT);
    await shot(page, 'p2b-06-hold-before.png', '.kw2-patient-header', 240);

    const hold = page.locator('button', { hasText: /^Hold$/ }).first();
    const enabled = (await hold.count()) > 0 && (await hold.isEnabled());
    console.log(`  Hold offered=${enabled}`);
    if (enabled) {
      await hold.click();
      await page.waitForTimeout(2200);
      await shot(page, 'p2b-07-hold-after.png', '.kw2-patient-header', 240);
    }
    await context.close();
  }

  // The queue's own view of a held patient — a different surface, so it is
  // captured from the queue rather than asserted from the header.
  {
    const { page, context } = await open(W, 1100, undefined, '/queue');
    await page.waitForTimeout(1800);
    const onHold = await page.locator('[data-on-hold="true"]').count();
    console.log(`  queue rows flagged on hold=${onHold}`);
    await shot(page, 'p2b-08-queue-on-hold.png');
    await context.close();
  }

  // And back again.
  {
    const { page, context } = await open(W, 1100, DOCUMENTED_VISIT);
    const resume = page.locator('button', { hasText: /^Resume$/ }).first();
    console.log(`  Resume offered=${(await resume.count()) > 0}`);
    if (await resume.count()) {
      await resume.click();
      await page.waitForTimeout(2200);
    }
    await shot(page, 'p2b-09-resumed.png', '.kw2-patient-header', 240);
    await context.close();
  }

  // === 4. Responsive thumbnails — this phase touched layout CSS ==========
  {
    const { page, context } = await open(1180, 900, LATEST_VISIT);
    const tab = page.locator('[data-testid="canvas-history-tab"]');
    if (await tab.count()) await tab.click().catch(() => {});
    await page.waitForTimeout(1000);
    await shot(page, 'p2b-10-thumb-1180-drawer.png');
    await context.close();
  }
  {
    const { page, context } = await open(390, 844, LATEST_VISIT);
    await page.screenshot({ path: join(OUT, 'p2b-11-thumb-390-stacked.png'), fullPage: true });
    const doc = await page.evaluate(() => document.documentElement.scrollWidth);
    console.log(`  p2b-11-thumb-390-stacked.png  doc=${doc}`);
    await context.close();
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
