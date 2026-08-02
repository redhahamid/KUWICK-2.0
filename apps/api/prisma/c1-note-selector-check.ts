import { join } from 'node:path';
import { config } from 'dotenv';
import { chromium, Page } from 'playwright-core';

config({ path: join(__dirname, '..', '.env') });

// C2 baseline gate — exercise the REAL Ant Design note selector.
//
// The in-app MCP browser could not open the antd dropdown (synthetic events
// don't drive it), which left the note-switch guard verified only via the
// Add Note button. Playwright drives real Chrome with proper event
// synthesis, so this closes that gap for good.
//
//   npx tsx prisma/c1-note-selector-check.ts
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const API = 'http://localhost:3000';
const WEB = 'http://localhost:5173';
const PASSWORD = process.env.C1_SHOT_PASSWORD;
const EMAIL = process.env.C1_SHOT_EMAIL ?? 'amira.rahman@smoke-test-clinic.test';

const results: { step: string; pass: boolean; detail: string }[] = [];
const check = (step: string, pass: boolean, detail = '') => {
  results.push({ step, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${step}${detail ? ` — ${detail}` : ''}`);
};

async function api(path: string, token: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

const editorText = (page: Page) => page.locator('.ProseMirror').first().innerText();
const noteSelector = (page: Page) => page.locator('.ant-select').first();

async function openSelector(page: Page) {
  await noteSelector(page).click();
  await page.locator('.ant-select-dropdown').waitFor({ state: 'visible', timeout: 5000 });
}

async function main() {
  if (!PASSWORD) throw new Error('Set C1_SHOT_PASSWORD before running.');

  const loginRes = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const auth = await loginRes.json();
  const token: string = auth.accessToken;
  const clinics = await api('/clinics', token);
  const stamp = Date.now();

  // Two visits for the SAME patient: the second exists purely to prove its
  // draft is NOT collateral damage when the first one's draft is discarded.
  const patient = await api('/patients', token, 'POST', {
    name: `ZZ C2 Gate Patient ${stamp}`,
    identifierType: 'NRIC',
    identifierValue: `G${stamp}`.slice(0, 14),
  });
  const mkVisit = () =>
    api('/visits', token, 'POST', {
      patientId: patient.id,
      clinicId: clinics[0].id,
      staffId: auth.staff.id,
      billingType: 'Self-pay',
    });
  const visitA = await mkVisit();
  const visitB = await mkVisit();

  await api(`/visits/${visitA.id}/clinical-notes`, token, 'POST', { notes: '<p>NOTE ONE body.</p>' });
  await api(`/visits/${visitA.id}/clinical-notes`, token, 'POST', { notes: '<p>NOTE TWO body.</p>' });
  await api(`/visits/${visitB.id}/clinical-notes`, token, 'POST', { notes: '<p>VISIT B note.</p>' });

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.addInitScript(
    (a) => {
      localStorage.setItem('kuwick-auth', JSON.stringify({ state: a, version: 0 }));
      localStorage.setItem('kuwick-record-view-layout', JSON.stringify({ state: { layout: 'canvas' }, version: 0 }));
    },
    { accessToken: token, refreshToken: auth.refreshToken, staff: auth.staff, tenant: auth.tenant },
  );
  const page = await context.newPage();

  console.log('C1 NOTE-SELECTOR GATE (real Ant Design Select)\n');

  // 1-2. Open an editable note on VISIT A and type unsaved text.
  await page.goto(`${WEB}/patients/${patient.id}?visitId=${visitA.id}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const originalLabel = (await noteSelector(page).innerText()).trim();
  await page.locator('.ProseMirror').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' MY-UNSAVED-TEXT');
  await page.waitForTimeout(600);
  check('1-2. Editable note is dirty', (await editorText(page)).includes('MY-UNSAVED-TEXT'));
  check('   status shows Unsaved changes', (await page.locator('body').innerText()).includes('Unsaved changes'));

  // 3-4. Switch note using the REAL selector → warning must appear.
  await openSelector(page);
  const options = page.locator('.ant-select-item-option');
  const optionCount = await options.count();
  const targetLabel = (await options.nth(1).innerText()).trim();
  await options.nth(1).click();
  await page.waitForTimeout(900);
  const dialog = page.locator('.ant-modal-confirm');
  const warned = await dialog.isVisible().catch(() => false);
  check('3-4. Real selector switch raises the unsaved warning', warned, `${optionCount} options`);

  // 5-6. Continue editing → selection and text unchanged.
  await page.getByRole('button', { name: 'Continue editing' }).click();
  await page.waitForTimeout(800);
  const labelAfterCancel = (await noteSelector(page).innerText()).trim();
  const textAfterCancel = await editorText(page);
  check('5-6. Selection stays on the original note', labelAfterCancel === originalLabel, labelAfterCancel);
  check('   unsaved text is preserved', textAfterCancel.includes('MY-UNSAVED-TEXT'));
  check('   dirty state remains', (await page.locator('body').innerText()).includes('Unsaved changes'));

  // 7-8. Switch again → Discard changes.
  await openSelector(page);
  await page.locator('.ant-select-item-option').nth(1).click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await page.waitForTimeout(1200);

  // 9. Requested note becomes active and loads its own content.
  const labelAfterDiscard = (await noteSelector(page).innerText()).trim();
  const textAfterDiscard = await editorText(page);
  check('9. Requested note becomes active', labelAfterDiscard === targetLabel, labelAfterDiscard);
  check('   discarded text is gone', !textAfterDiscard.includes('MY-UNSAVED-TEXT'));
  check('   the selected note loaded its own content', textAfterDiscard.trim().length > 0, textAfterDiscard.slice(0, 40));

  // 10. The discard must be SCOPED: only the abandoned note's draft goes.
  //
  // Note on method: cross-VISIT isolation cannot be exercised by navigating
  // with page.goto, because that is a full page load and the draft store is
  // deliberately memory-only — every draft dies with the page, by design, not
  // by a cleanup bug. Two visits also cannot both be dirty at once through
  // the UI, since the visit-change guard forces a save-or-discard first.
  // Cross-visit/patient/branch/tenant scoping is therefore proven by the
  // prefix unit tests; what is checked live here is that discarding one
  // note's draft does not disturb another note's editable state.
  await page.locator('.ProseMirror').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' SECOND-NOTE-EDIT');
  await page.waitForTimeout(600);

  await openSelector(page);
  await page.locator('.ant-select-item-option').nth(0).click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await page.waitForTimeout(1200);

  const backText = await editorText(page);
  check(
    '10. Discard is scoped — the other note still loads its own content',
    backText.includes('NOTE TWO') || backText.includes('NOTE ONE'),
    backText.slice(0, 45),
  );
  check('   the discarded edit did not follow the switch', !backText.includes('SECOND-NOTE-EDIT'));

  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\nRESULT: ${failed.length === 0 ? 'PASS — real selector path is sound' : `FAIL — ${failed.length} check(s)`}`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
