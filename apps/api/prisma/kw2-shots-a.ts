import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from 'dotenv';
import { chromium, Page } from 'playwright-core';

config({ path: join(__dirname, '..', '.env') });

/**
 * Kuwick 2.0 Canvas — SECTION A shots: the allergy strip and the checkpoint.
 *
 * Driven against the MANDATORY SAFETY FIXTURE: a patient recorded as allergic
 * to NSAIDs with a past visit prescribing Ibuprofen 400mg. Copy shows the
 * amber name match; completing with it prescribed shows the checkpoint.
 *
 * SYNTHETIC DATA ONLY, and the allergy field is put back as it was found.
 *
 *   npx tsx prisma/kw2-shots-a.ts
 */
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium';
const API = 'http://localhost:3000';
const WEB = 'http://localhost:5173';
const OUT = join(__dirname, '..', '..', '..', 'docs', 'kuwick2-canvas-section-a');
const CHROME_PADDING = 64;
const W = 1600 + CHROME_PADDING;

const PATIENT = '26a75e53-21b8-40ef-a306-2ffce83b67f4';
/** The NSAIDs + Ibuprofen 400mg safety fixture, IN_CONSULTATION. */
const FIXTURE_VISIT = '25945379-88e3-4c9b-b6fa-d53df7c25658';
const LATEST_VISIT = 'dd25871c-5617-4b3c-824f-fd4cb10225df';

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
  const auth = { Authorization: `Bearer ${owner.accessToken}`, 'Content-Type': 'application/json' };

  const before = (await (await fetch(`${API}/patients/${PATIENT}`, { headers: auth })).json()) as {
    allergies: string[] | null;
  };
  const setAllergies = (allergies: string[] | null) =>
    fetch(`${API}/patients/${PATIENT}`, {
      method: 'PATCH',
      headers: auth,
      body: JSON.stringify({ allergies }),
    });

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  console.log(`\nSection A — allergy strip + checkpoint -> ${OUT}`);
  console.log('='.repeat(72));

  const open = async (visitId: string, width = W, height = 1100) => {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
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
    await page
      .goto(`${WEB}/patients/${PATIENT}?visitId=${visitId}`, { waitUntil: 'networkidle' })
      .catch(() => {});
    await page.waitForTimeout(2600);
    return { page, context };
  };

  const clipShot = async (page: Page, file: string, selector: string, maxHeight = 900) => {
    const box = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: Math.max(0, Math.round(r.x) - 10),
        y: Math.max(0, Math.round(r.y) - 10),
        width: Math.round(r.width) + 20,
        height: Math.round(r.height) + 20,
      };
    }, selector);
    if (!box) {
      console.log(`  !! ${file}: ${selector} not found`);
      return false;
    }
    await page.screenshot({
      path: join(OUT, file),
      clip: { ...box, height: Math.min(box.height, maxHeight) },
    });
    console.log(`  ${file}  ${box.width}x${Math.min(box.height, maxHeight)}`);
    return true;
  };

  // --- A2. The strip on the medications card, all three states -----------
  const stripShot = async (file: string, allergies: string[] | null, note: string) => {
    await setAllergies(allergies);
    const { page, context } = await open(FIXTURE_VISIT);
    const ok = await clipShot(page, file, '#kw-anchor-medications', 520);
    if (ok) console.log(`     (${note})`);
    await context.close();
  };

  await stripShot('a-01-strip-present.png', ['NSAIDs'], 'allergies on record — amber, verbatim');
  await stripShot('a-02-strip-not-asked.png', null, 'never asked — its own warning');
  await stripShot('a-03-strip-none-known.png', [], 'asked and none known — NO strip');

  // --- A2. The strip inside the add flow ---------------------------------
  {
    await setAllergies(['NSAIDs']);
    const { page, context } = await open(FIXTURE_VISIT);
    const add = page.locator('button', { hasText: 'Add Medication' }).first();
    if (await add.count()) {
      await add.click();
      await page.waitForTimeout(1500);
      await clipShot(page, 'a-04-strip-in-add-flow.png', '.ant-modal', 700);
    } else {
      console.log('  !! a-04: no Add Medication control');
    }
    await context.close();
  }

  // --- A2. The strip + amber name match in Copy Rx -----------------------
  {
    const { page, context } = await open(LATEST_VISIT);
    const copy = page
      .locator('[data-testid="canvas-visit-past"]')
      .nth(1)
      .locator('button', { hasText: 'Copy Rx' });
    if (await copy.count()) {
      await copy.click();
      await page.waitForTimeout(1600);
      await clipShot(page, 'a-05-copyrx-strip-and-match.png', '.ant-modal', 700);
    } else {
      console.log('  !! a-05: no Copy Rx control');
    }
    await context.close();
  }

  // --- A3. The completion checkpoint -------------------------------------
  {
    const { page, context } = await open(FIXTURE_VISIT);
    const complete = page.locator('.kw-consult-footer button', { hasText: /^Complete/ }).first();
    if (await complete.count()) {
      await complete.click();
      await page.waitForTimeout(1500);
      await clipShot(page, 'a-06-completion-checkpoint.png', '.ant-modal', 700);
      const focused = await page.evaluate(() => document.activeElement?.textContent ?? '(none)');
      console.log(`     default focus = "${focused}"`);
    } else {
      console.log('  !! a-06: no Complete control on the footer');
    }
    await context.close();
  }

  await setAllergies(before.allergies);
  console.log(`  allergies restored to ${JSON.stringify(before.allergies)}`);
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
