import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from 'dotenv';
import { chromium, Page } from 'playwright-core';

config({ path: join(__dirname, '..', '.env') });

// G4.5d3c-3c1 — the six approved correction screenshots.
//
// Seed first, then pass the two visit ids the seeder prints:
//   KUWICK_ALLOW_FIXTURES=yes npx tsx prisma/g45d3c3c-canvas-speed-check.ts --seed-only
//   npx tsx prisma/g45d3c3c1-vitals-attachment-shots.ts <pendingVisitId> <freshVisitId>
//
// The FIRST visit already has a saved reading (so it shows the compact
// resting state and Edit); the SECOND is used with its observations removed,
// so the first-entry state is genuine rather than staged.
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium';
const API = 'http://localhost:3000';
const WEB = 'http://localhost:5173';
const OUT = join(__dirname, '..', '..', '..', 'docs', 'g45d3c3c1-screenshots');

const DESKTOP = { width: 1440, height: 1000 };
const MOBILE = { width: 375, height: 812 };

const SAVED_VISIT = process.argv[2];
const FRESH_VISIT = process.argv[3];

if (!SAVED_VISIT || !FRESH_VISIT) {
  console.error('Usage: npx tsx prisma/g45d3c3c1-vitals-attachment-shots.ts <savedVisitId> <freshVisitId>');
  process.exit(1);
}

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const PDF_BYTES = Buffer.from('%PDF-1.7\n%KUWICK referral letter\n', 'ascii');
/** A Windows executable, renamed and relabelled — refused on its bytes. */
const FAKE_PDF = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(64)]);

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
  const token = doctor.accessToken as string;
  const savedPatient = await patientOf(SAVED_VISIT, token);
  const freshPatient = await patientOf(FRESH_VISIT, token);

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  console.log(`\nG4.5d3c-3c1 screenshots -> ${OUT}`);
  console.log('='.repeat(70));

  const open = async (viewport: { width: number; height: number }, url: string) => {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    await context.addInitScript(
      (a) => {
        localStorage.setItem('kuwick-auth', JSON.stringify({ state: a, version: 0 }));
        localStorage.setItem(
          'kuwick-record-view-layout',
          JSON.stringify({ state: { layout: 'canvas' }, version: 0 }),
        );
      },
      { accessToken: doctor.accessToken, refreshToken: doctor.refreshToken, staff: doctor.staff, tenant: doctor.tenant },
    );
    const page = await context.newPage();
    await page.goto(`${WEB}${url}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1800);
    return { page, context };
  };

  const canvas = (patientId: string, visitId: string) => `/patients/${patientId}?visitId=${visitId}`;

  /** Opens the vitals panel from the Canvas strip. */
  const openVitals = async (page: Page) => {
    const control = page.getByRole('button', { name: /record \/ edit|^record vitals$|^record$/i }).first();
    if (await control.count()) {
      await control.click();
      await page.waitForTimeout(800);
    }
  };

  // --- 1. First entry: the fields are open, nothing else ----------------
  {
    const { page, context } = await open(DESKTOP, canvas(freshPatient, FRESH_VISIT));
    await openVitals(page);
    await shot(page, '01-desktop-first-vitals-entry-fields-open');

    const mode = await page.locator('[data-vitals-mode]').first().getAttribute('data-vitals-mode');
    const hasCancel = await page.getByRole('button', { name: 'Cancel' }).count();
    console.log(`  first-entry mode: ${mode}, Cancel offered: ${hasCancel > 0 ? 'yes' : 'no'}`);
    await context.close();
  }

  // --- 2. Saved: the compact resting state -------------------------------
  {
    const { page, context } = await open(DESKTOP, canvas(savedPatient, SAVED_VISIT));
    await openVitals(page);
    await shot(page, '02-desktop-saved-vitals-compact-resting-state');

    const report = await page.evaluate(() => {
      const card = document.querySelector('[data-vitals-mode]') as HTMLElement | null;
      return {
        mode: card?.getAttribute('data-vitals-mode') ?? null,
        // The correction: no entry field may be on screen in the resting state.
        openInputs: card ? card.querySelectorAll('input.ant-input-number-input').length : -1,
        cardHeight: card?.getBoundingClientRect().height ?? null,
      };
    });
    console.log(`  resting state: ${JSON.stringify(report)}`);
    await context.close();
  }

  // --- 3. Edit: populated ------------------------------------------------
  {
    const { page, context } = await open(DESKTOP, canvas(savedPatient, SAVED_VISIT));
    await openVitals(page);
    await page.getByRole('button', { name: 'Edit' }).first().click();
    await page.waitForTimeout(700);
    await shot(page, '03-desktop-edit-vitals-populated');

    const populated = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll('input.ant-input-number-input')] as HTMLInputElement[];
      return inputs.filter((input) => input.value !== '').length;
    });
    console.log(`  populated fields in Edit: ${populated}`);
    await context.close();
  }

  // --- 4. Mobile: the compact summary ------------------------------------
  {
    const { page, context } = await open(MOBILE, canvas(savedPatient, SAVED_VISIT));
    await openVitals(page);
    await shot(page, '04-mobile-saved-vitals-compact-summary');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    console.log(`  mobile horizontal overflow: ${overflow ? 'OVERFLOWS' : 'none'}`);
    await context.close();
  }

  // --- 5. Mixed valid and rejected upload --------------------------------
  {
    const { page, context } = await open(DESKTOP, canvas(savedPatient, SAVED_VISIT));
    const uploadToggle = page.getByRole('button', { name: /^upload$/i }).first();
    if (await uploadToggle.count()) {
      await uploadToggle.click();
      await page.waitForTimeout(600);
    }

    const input = page.locator('input[type="file"]').first();
    await input.setInputFiles([
      { name: 'wound-photo.png', mimeType: 'image/png', buffer: PNG_BYTES },
      // Declared and named as a PDF; the bytes are an executable. Only the
      // server can tell, and it does.
      { name: 'referral-scan.pdf', mimeType: 'application/pdf', buffer: FAKE_PDF },
      { name: 'lab-report.pdf', mimeType: 'application/pdf', buffer: PDF_BYTES },
    ]);
    await page.waitForTimeout(3000);
    await shot(page, '05-desktop-mixed-valid-and-rejected-upload');

    const errors = await page.evaluate(() =>
      [...document.querySelectorAll('[data-upload-error]')].map((node) => ({
        file: node.getAttribute('data-upload-error'),
        text: (node.textContent ?? '').trim(),
      })),
    );
    console.log(`  per-file errors: ${JSON.stringify(errors)}`);
    await context.close();
  }

  // --- 6. Image and PDF presentation after validation --------------------
  {
    const { page, context } = await open(DESKTOP, canvas(savedPatient, SAVED_VISIT));
    const uploadToggle = page.getByRole('button', { name: /^upload$/i }).first();
    if (await uploadToggle.count()) {
      await uploadToggle.click();
      await page.waitForTimeout(900);
    }
    await shot(page, '06-desktop-image-and-pdf-after-validation');

    const presentation = await page.evaluate(() => ({
      pdfCards: document.querySelectorAll('[data-attachment-kind="PDF"]').length,
      brokenImages: [...document.querySelectorAll('img')].filter(
        (img) => img.complete && img.naturalWidth === 0,
      ).length,
    }));
    console.log(`  presentation: ${JSON.stringify(presentation)}`);
    await context.close();
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
