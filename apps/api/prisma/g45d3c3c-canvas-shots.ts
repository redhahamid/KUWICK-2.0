import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from 'dotenv';
import { chromium, Page } from 'playwright-core';

config({ path: join(__dirname, '..', '.env') });

// G4.5d3c-3c — the twenty approved Canvas speed / documentation screenshots.
//
// Seed first, then pass the two visit ids the seeder prints:
//   KUWICK_ALLOW_FIXTURES=yes npx tsx prisma/g45d3c3c-canvas-speed-check.ts --seed-only
//   npx tsx prisma/g45d3c3c-canvas-shots.ts <pendingVisitId> <signedVisitId>
//
// Every shot is a POPULATED record against the running API. Nothing is mocked
// and nothing is staged for the camera.
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium';
const API = 'http://localhost:3000';
const WEB = 'http://localhost:5173';
const OUT = join(__dirname, '..', '..', '..', 'docs', 'g45d3c3c-screenshots');

const DESKTOP = { width: 1440, height: 1000 };
const TABLET = { width: 834, height: 1112 };
const MOBILE = { width: 375, height: 812 };

const PENDING_VISIT = process.argv[2];
const SIGNED_VISIT = process.argv[3];

if (!PENDING_VISIT || !SIGNED_VISIT) {
  console.error('Usage: npx tsx prisma/g45d3c3c-canvas-shots.ts <pendingVisitId> <signedVisitId>');
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

async function patientOf(visitId: string, token: string): Promise<string> {
  const res = await fetch(`${API}/visits/${visitId}`, { headers: { Authorization: `Bearer ${token}` } });
  const visit = (await res.json()) as { patientId: string };
  return visit.patientId;
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`  ${name}.png`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const doctor = await login('amira.rahman@smoke-test-clinic.test');
  const pendingPatient = await patientOf(PENDING_VISIT, doctor.accessToken as string);
  const signedPatient = await patientOf(SIGNED_VISIT, doctor.accessToken as string);

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  console.log(`\nG4.5d3c-3c screenshots -> ${OUT}`);
  console.log('='.repeat(70));

  const open = async (viewport: { width: number; height: number }, url: string) => {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    await context.addInitScript(
      (a) => {
        localStorage.setItem('kuwick-auth', JSON.stringify({ state: a, version: 0 }));
        // The Canvas layout is the surface every one of these shots is about.
        localStorage.setItem(
          'kuwick-record-view-layout',
          JSON.stringify({ state: { layout: 'canvas' }, version: 0 }),
        );
      },
      {
        accessToken: doctor.accessToken,
        refreshToken: doctor.refreshToken,
        staff: doctor.staff,
        tenant: doctor.tenant,
      },
    );
    const page = await context.newPage();
    await page.goto(`${WEB}${url}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1800);
    return { page, context };
  };

  const canvas = (patientId: string, visitId: string) => `/patients/${patientId}?visitId=${visitId}`;

  // --- 1–3. The bounded editor ------------------------------------------
  {
    const { page, context } = await open(DESKTOP, canvas(pendingPatient, PENDING_VISIT));
    await shot(page, '01-desktop-canvas-bounded-editor');

    // Enough text to overflow the ceiling, so the shot shows the editor
    // scrolling INSIDE itself while the page below stays where it was.
    // Inserted through the clipboard rather than keystroke by keystroke —
    // 2,800 individual key events took minutes and proved nothing extra.
    const editable = page.locator('.ProseMirror').first();
    await editable.click();
    const longNote = Array.from(
      { length: 40 },
      (_, i) => `Line ${i + 1}: subjective, objective, assessment and plan text.`,
    ).join('\n');
    await page.evaluate((text) => {
      const data = new DataTransfer();
      data.setData('text/plain', text);
      document
        .querySelector('.ProseMirror')
        ?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, longNote);
    await page.waitForTimeout(800);
    await shot(page, '02-desktop-editor-scrolls-internally-not-the-page');

    const measured = await page.evaluate(() => {
      const node = document.querySelector('.ProseMirror') as HTMLElement | null;
      if (!node) return null;
      const style = window.getComputedStyle(node);
      return {
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        maxHeight: style.maxHeight,
        overflowY: style.overflowY,
      };
    });
    console.log(`\n  editor box: ${JSON.stringify(measured)}`);

    // 3. Focus Mode — the rail stands down, the note keeps its text.
    await page.getByRole('button', { name: 'Focus Mode' }).click();
    await page.waitForTimeout(600);
    await shot(page, '03-desktop-focus-mode');

    const kept = await page.evaluate(
      () => (document.querySelector('.ProseMirror') as HTMLElement | null)?.innerText.length ?? 0,
    );
    console.log(`  characters still in the editor after entering Focus Mode: ${kept}`);

    await page.getByRole('button', { name: 'Exit Focus Mode' }).click();
    await page.waitForTimeout(500);
    await shot(page, '04-desktop-focus-mode-exited');
    await context.close();
  }

  // --- 5–8. Vitals, fields-first, with live BMI -------------------------
  {
    const { page, context } = await open(DESKTOP, canvas(pendingPatient, PENDING_VISIT));

    // The compact strip carries the saved reading and the way in.
    await shot(page, '05-desktop-vitals-strip-with-bmi');

    const recordEdit = page.getByRole('button', { name: /record \/ edit|^record$/i }).first();
    await recordEdit.click();
    await page.waitForTimeout(700);
    await shot(page, '06-desktop-vitals-fields-immediately-available');

    // Live BMI, typed. By LABEL: antd derives the input id from the Form.Item
    // name, and guessing that id silently skipped this shot on the first run.
    const weight = page.getByLabel('Weight (kg)').first();
    const height = page.getByLabel('Height (cm)').first();
    await weight.fill('82');
    await height.fill('175');
    await page.waitForTimeout(600);
    await shot(page, '07-desktop-live-bmi-while-typing');

    const bmiText = await page.locator('[data-testid="live-bmi"]').first().innerText();
    console.log(`  live BMI readout: ${bmiText.replace(/\n/g, ' ')}`);
    await shot(page, '08-desktop-vitals-compact-editable-summary');
    await context.close();
  }

  // --- 9–11. Attachments: multi-file and PDF presentation ---------------
  {
    const { page, context } = await open(DESKTOP, canvas(pendingPatient, PENDING_VISIT));

    const uploadToggle = page.getByRole('button', { name: /^upload$/i }).first();
    if (await uploadToggle.count()) {
      await uploadToggle.click();
      await page.waitForTimeout(600);
    }
    await shot(page, '09-desktop-attachments-panel');

    const input = page.locator('input[type="file"]').first();
    await input.setInputFiles([
      { name: 'wound-photo.png', mimeType: 'image/png', buffer: pngBytes() },
      { name: 'referral-letter.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%KUWICK\n') },
      { name: 'lab-report.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%KUWICK\n') },
    ]);
    await page.waitForTimeout(900);
    await shot(page, '10-desktop-multi-file-upload-per-file-progress');
    await page.waitForTimeout(2500);
    await shot(page, '11-desktop-pdf-presented-as-file-card');

    const brokenImages = await page.evaluate(() =>
      [...document.querySelectorAll('img')].filter(
        (img) => img.complete && img.naturalWidth === 0,
      ).length,
    );
    console.log(`\n  broken image elements on the record: ${brokenImages}`);
    await context.close();
  }

  // --- 12–13. Medication supply mode ------------------------------------
  {
    const { page, context } = await open(DESKTOP, canvas(pendingPatient, PENDING_VISIT));
    await page.getByRole('button', { name: 'Add Medication' }).first().click();
    await page.waitForTimeout(1200);
    await shot(page, '12-desktop-supply-mode-visible-default');

    const drawer = page.locator('.ant-drawer-body');
    await drawer.getByText('Supply Mode').first().scrollIntoViewIfNeeded().catch(() => undefined);
    await page.waitForTimeout(400);
    await shot(page, '13-desktop-supply-mode-labelled-as-default');
    await context.close();
  }

  // --- 14–16. The completion footer, Cases A/B/D ------------------------
  {
    const { page, context } = await open(DESKTOP, canvas(pendingPatient, PENDING_VISIT));
    await page.locator('.kw-consult-footer').scrollIntoViewIfNeeded().catch(() => undefined);
    await page.waitForTimeout(600);
    await shot(page, '14-desktop-footer-case-b-documentation-pending-amber');

    const complete = page.locator('.kw-consult-footer button', { hasText: /^Complete/ }).first();
    if (await complete.count()) {
      await complete.click();
      await page.waitForTimeout(900);
      await shot(page, '15-desktop-send-with-documentation-pending-confirmation');
      await page.keyboard.press('Escape');
      await page.locator('.ant-modal-wrap').waitFor({ state: 'hidden' }).catch(() => undefined);
      await page.waitForTimeout(500);
    }
    await context.close();
  }

  {
    const { page, context } = await open(DESKTOP, canvas(signedPatient, SIGNED_VISIT));
    await page.locator('.kw-consult-footer').scrollIntoViewIfNeeded().catch(() => undefined);
    await page.waitForTimeout(600);
    await shot(page, '16-desktop-footer-case-a-documentation-complete');
    await context.close();
  }

  // --- 17–18. Tablet ----------------------------------------------------
  {
    const { page, context } = await open(TABLET, canvas(pendingPatient, PENDING_VISIT));
    await shot(page, '17-tablet-canvas-bounded-editor');
    await page.locator('.kw-consult-footer').scrollIntoViewIfNeeded().catch(() => undefined);
    await page.waitForTimeout(500);
    await shot(page, '18-tablet-footer-documentation-pending');
    await context.close();
  }

  // --- 19–20. Mobile ----------------------------------------------------
  {
    const { page, context } = await open(MOBILE, canvas(pendingPatient, PENDING_VISIT));
    await shot(page, '19-mobile-canvas-bounded-editor');

    const recordEdit = page.getByRole('button', { name: /record \/ edit|^record$/i }).first();
    if (await recordEdit.count()) {
      await recordEdit.click();
      await page.waitForTimeout(700);
    }
    await shot(page, '20-mobile-vitals-fields-and-live-bmi');
    await context.close();
  }

  // --- Overflow and editor-height report at all three widths ------------
  console.log('\nHORIZONTAL OVERFLOW AND EDITOR CEILING');
  for (const [name, viewport] of [['desktop', DESKTOP], ['tablet', TABLET], ['mobile', MOBILE]] as const) {
    const { page, context } = await open(viewport, canvas(pendingPatient, PENDING_VISIT));
    const report = await page.evaluate(() => {
      const node = document.querySelector('.ProseMirror') as HTMLElement | null;
      const style = node ? window.getComputedStyle(node) : null;
      return {
        overflows: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        editorHeight: node?.clientHeight ?? null,
        maxHeight: style?.maxHeight ?? null,
        overflowY: style?.overflowY ?? null,
      };
    });
    console.log(
      `  ${name.padEnd(8)} ${report.overflows ? 'OVERFLOWS' : 'no overflow'}  editor=${report.editorHeight}px  max-height=${report.maxHeight}  overflow-y=${report.overflowY}`,
    );
    await context.close();
  }

  await browser.close();
}

/** A minimal valid 1x1 PNG, so the thumbnail is a real image rather than a stub. */
function pngBytes(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
