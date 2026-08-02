import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import { chromium } from 'playwright-core';

config({ path: join(__dirname, '..', '.env') });

// C1 closure (D-052) — capture the unsaved-safety states as real PNGs.
// Same approach as the C0 script: locally-installed Chrome via
// playwright-core (no browser download), real login, safe test data only.
//
//   npx tsx prisma/c1-review-screenshots.ts   (with dev servers running)
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const API = 'http://localhost:3000';
const WEB = 'http://localhost:5173';
const OUT = join(__dirname, '..', '..', '..', 'docs', 'c1-screenshots');

const EMAIL = process.env.C1_SHOT_EMAIL ?? 'amira.rahman@smoke-test-clinic.test';
const PASSWORD = process.env.C1_SHOT_PASSWORD;

async function api(path: string, token: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  if (!PASSWORD) throw new Error('Set C1_SHOT_PASSWORD before running.');
  mkdirSync(OUT, { recursive: true });

  const loginRes = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!loginRes.ok) throw new Error(`Login failed: ${loginRes.status}`);
  const auth = await loginRes.json();
  const token: string = auth.accessToken;

  const stamp = Date.now();
  const patient = await api('/patients', token, 'POST', {
    name: `ZZ C1 Review Patient ${stamp}`,
    identifierType: 'NRIC',
    identifierValue: `C1${stamp}`.slice(0, 14),
  });
  const clinics = await api('/clinics', token);
  const visit = await api('/visits', token, 'POST', {
    patientId: patient.id,
    clinicId: clinics[0].id,
    staffId: auth.staff.id,
    billingType: 'Self-pay',
    presentingComplaint: 'C1 review scenario',
  });
  await api(`/visits/${visit.id}/clinical-notes`, token, 'POST', {
    notes: '<p>Saved baseline text for the C1 review.</p>',
  });

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  await context.addInitScript(
    (a) => {
      localStorage.setItem('kuwick-auth', JSON.stringify({ state: a, version: 0 }));
      localStorage.setItem('kuwick-record-view-layout', JSON.stringify({ state: { layout: 'canvas' }, version: 0 }));
    },
    { accessToken: token, refreshToken: auth.refreshToken, staff: auth.staff, tenant: auth.tenant },
  );
  const page = await context.newPage();
  const url = `${WEB}/patients/${patient.id}?visitId=${visit.id}`;
  const shot = async (name: string) => {
    await page.screenshot({ path: join(OUT, `${name}.png`) });
    console.log(`  saved ${name}.png`);
  };

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1800);

  // 1. Unsaved state.
  const editor = page.locator('.ProseMirror');
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Doctor is typing — not yet saved.');
  await page.waitForTimeout(700);
  await shot('01-unsaved-changes');

  // 2. Successful save.
  await page.getByRole('button', { name: 'Save Clinical Note' }).click();
  await page.waitForTimeout(2200);
  await shot('02-saved-successfully');

  // 3. Note-switch warning while dirty.
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' More unsaved text.');
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'Add Note' }).click();
  await page.waitForTimeout(900);
  await shot('03-unsaved-switch-warning');
  await page.getByRole('button', { name: 'Continue editing' }).click();
  await page.waitForTimeout(700);

  // 4. Save failure (server refuses) — text must remain.
  await page.route('**/clinical-notes/**', (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Server unavailable' }) })
      : route.continue(),
  );
  await page.getByRole('button', { name: 'Save Clinical Note' }).click();
  await page.waitForTimeout(2000);
  await shot('04-save-failed-text-kept');
  await page.unroute('**/clinical-notes/**');

  // 5. Conflict (409) with the doctor's text preserved and reviewable.
  await page.route('**/clinical-notes/**', (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'This note was changed by someone else. Reload before saving.', statusCode: 409 }),
        })
      : route.continue(),
  );
  await page.getByRole('button', { name: 'Save Clinical Note' }).click();
  await page.waitForTimeout(2200);
  await shot('05-conflict-detected');
  await page.unroute('**/clinical-notes/**');

  await browser.close();
  console.log(`\nReview patient: ${patient.name}  visit ${visit.id}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
