import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import * as jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { chromium, Page } from 'playwright-core';
import { FixtureLedger, assertFixturesAllowed, fixtureLabel, sweepOrphanedFixtures } from './fixture-support';

config({ path: join(__dirname, '..', '.env') });

// G0 closure — the two consumers C0 (D-051) left depending on vitals after
// they were split out of the clinical note:
//
//   A. Document templates (formatVitals → Generate Template)
//   B. The paediatric weight-based dosage calculator
//
// Both read through useLatestVitals, which prefers a real attributed
// VisitObservation and falls back to a legacy note's FROZEN vitals columns for
// visits recorded before the split. Both paths are exercised here end to end
// in real Chrome — the fallback is the one that would fail silently and only
// show up as a blank field on a referral letter or an empty weight box.
//
//   KUWICK_ALLOW_FIXTURES=yes npx tsx prisma/g0-clinical-consumers-check.ts [--shots]
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const API = 'http://localhost:3000';
const WEB = 'http://localhost:5173';
const SHOTS = process.argv.includes('--shots');
const OUT = join(__dirname, '..', '..', '..', 'docs', 'g0-screenshots');

// Distinctive values so a match cannot be a coincidence or a default.
const OBS = { bpSystolic: 128, bpDiastolic: 82, pulse: 76, temperature: 37.4, spo2: 97, respRate: 18, weight: 12.6, height: 92.5, glucose: 5.4 };
const LEGACY = { bpSystolic: 141, bpDiastolic: 93, pulse: 65, temperature: 36.2, spo2: 95, respRate: 15, weight: 9.8, height: 78.4, glucose: 6.1 };

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
let ledger: FixtureLedger | undefined;

const results: { name: string; pass: boolean; detail: string }[] = [];
function check(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

async function api(path: string, token: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

// Flow layout puts Documents and Medications on their own full tabs, which is
// the least fiddly way to drive them; the underlying components are the same
// ones Canvas renders in a modal.
async function openFlowTab(page: Page, patientId: string, visitId: string, tabLabel: string) {
  await page.goto(`${WEB}/patients/${patientId}?visitId=${visitId}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.getByText(tabLabel, { exact: true }).first().click();
  await page.waitForTimeout(1200);
}

async function main() {
  assertFixturesAllowed();
  if (SHOTS) mkdirSync(OUT, { recursive: true });

  const seed = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    const rows = await tx.$queryRawUnsafe<
      { user_id: string; staff_id: string; tenant_id: string; role: string; full_name: string; tenant_name: string }[]
    >(`
      SELECT u.id AS user_id, s.id AS staff_id, s.tenant_id, s.role, s.full_name, t.name AS tenant_name
      FROM staff s JOIN users u ON s.user_id = u.id JOIN tenants t ON t.id = s.tenant_id
      WHERE s.active AND s.role IN ('DOCTOR_RESIDENT','DOCTOR_LOCUM') LIMIT 1
    `);
    if (rows.length === 0) throw new Error('No active doctor with a user account found');
    return rows[0];
  });

  const token = jwt.sign(
    { sub: seed.user_id, tenantId: seed.tenant_id, staffId: seed.staff_id, role: seed.role },
    process.env.JWT_ACCESS_SECRET as string,
    { expiresIn: '30m' },
  );

  const swept = await sweepOrphanedFixtures(prisma, seed.tenant_id);
  if (swept > 0) console.log(`Swept ${swept} leftover fixture visit(s)`);
  ledger = new FixtureLedger(prisma, API, token, seed.tenant_id);

  const clinics = await api('/clinics', token);
  const clinicId: string = clinics[0].id;

  // A paediatric patient — the weight calculator's whole reason to exist.
  const stamp = Date.now();
  const child = await api('/patients', token, 'POST', {
    name: fixtureLabel('Paediatric Patient'),
    // PASSPORT, not NRIC: an NRIC would auto-derive dob/gender (Phase A2) and
    // this fixture needs an explicit paediatric date of birth.
    identifierType: 'PASSPORT',
    identifierValue: `FIX${stamp}`.slice(0, 14),
    dob: '2023-02-01',
    gender: 'FEMALE',
  });
  ledger.patient(child.id);

  const mkVisit = async (complaint: string) => {
    const visit = await api('/visits', token, 'POST', {
      clinicId,
      patientId: child.id,
      staffId: seed.staff_id,
      billingType: 'Cash',
      presentingComplaint: fixtureLabel(complaint),
    });
    ledger!.visit(visit.id);
    return visit;
  };

  // --- current visit: real attributed observation ------------------------
  const currentVisit = await mkVisit('G0 consumers — observation path');
  await api(`/visits/${currentVisit.id}/observations`, token, 'POST', OBS);

  // --- legacy visit: frozen note vitals, NO observation row --------------
  const legacyVisit = await mkVisit('G0 consumers — legacy fallback');
  const legacyNote = await api(`/visits/${legacyVisit.id}/clinical-notes`, token, 'POST', {
    notes: '<p>Pre-split visit.</p>',
    noteLanguage: 'EN',
    noteType: 'DOCTOR_NARRATIVE',
  });
  // The legacy columns are frozen — nothing in the application writes them
  // any more, so a pre-split visit can only be reconstructed directly. This is
  // the fixture standing in for real historical data; the note itself was
  // created through the normal authored path.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${seed.tenant_id}, true)`;
    await tx.$executeRawUnsafe(`
      UPDATE clinical_notes SET bp_systolic = ${LEGACY.bpSystolic}, bp_diastolic = ${LEGACY.bpDiastolic},
        pulse = ${LEGACY.pulse}, temperature = ${LEGACY.temperature}, spo2 = ${LEGACY.spo2},
        resp_rate = ${LEGACY.respRate}, weight = ${LEGACY.weight}, height = ${LEGACY.height},
        glucose = ${LEGACY.glucose}
      WHERE id = '${legacyNote.id}'`);
  });

  const legacyObs = await api(`/visits/${legacyVisit.id}/observations`, token);
  check(
    'legacy visit genuinely has NO observation row (fallback is really under test)',
    legacyObs.length === 0,
    `${legacyObs.length} observation(s)`,
  );

  const browser = await chromium.launch({ executablePath: CHROME, headless: false });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.addInitScript(
    (a) => {
      localStorage.setItem('kuwick-auth', JSON.stringify({ state: a, version: 0 }));
      localStorage.setItem('kuwick-record-view-layout', JSON.stringify({ state: { layout: 'flow' }, version: 0 }));
    },
    {
      accessToken: token,
      refreshToken: token,
      staff: { id: seed.staff_id, fullName: seed.full_name, role: seed.role, clinicId: null },
      tenant: { id: seed.tenant_id, name: seed.tenant_name, slug: null },
    },
  );
  const page = await context.newPage();

  // ======================= A. DOCUMENT OBSERVATION VALUES =================
  const generateReferral = async (visitId: string) => {
    await openFlowTab(page, child.id, visitId, 'Documents');
    await page.locator('.ant-select').first().click();
    await page.getByText('Referral Letter', { exact: true }).first().click();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: /Generate Template/i }).click();
    await page.waitForTimeout(800);
    return page.locator('textarea').first().inputValue();
  };

  const docCurrent = await generateReferral(currentVisit.id);
  if (SHOTS) await page.screenshot({ path: join(OUT, 'g0-document-observation-values.png') });

  check(
    'document: BP from the observation',
    docCurrent.includes(`${OBS.bpSystolic}/${OBS.bpDiastolic}`),
    `expected ${OBS.bpSystolic}/${OBS.bpDiastolic}`,
  );
  check('document: pulse from the observation', docCurrent.includes(`${OBS.pulse} bpm`), `expected ${OBS.pulse} bpm`);
  check(
    'document: temperature from the observation',
    docCurrent.includes(`${OBS.temperature}`),
    `expected ${OBS.temperature}`,
  );
  check('document: SpO2 from the observation', docCurrent.includes(`${OBS.spo2}%`), `expected ${OBS.spo2}%`);
  check(
    'document: respiratory rate from the observation',
    docCurrent.includes(`${OBS.respRate}/min`),
    `expected ${OBS.respRate}/min`,
  );
  // Reported, not asserted as a pass: formatVitals() has never included
  // weight, height or glucose. That is existing document-content design, not
  // a fault in the vitals split — changing what a referral letter says is a
  // clinical-content decision, not a G0 one.
  console.log(
    `NOTE  weight/height/glucose in document: ${
      docCurrent.includes(String(OBS.weight)) ? 'present' : 'ABSENT — formatVitals omits them by existing design'
    }`,
  );

  const docLegacy = await generateReferral(legacyVisit.id);
  if (SHOTS) await page.screenshot({ path: join(OUT, 'g0-document-legacy-fallback.png') });
  check(
    'document legacy fallback: BP from the frozen note columns',
    docLegacy.includes(`${LEGACY.bpSystolic}/${LEGACY.bpDiastolic}`),
    `expected ${LEGACY.bpSystolic}/${LEGACY.bpDiastolic}`,
  );
  check(
    'document legacy fallback: temperature from the frozen note columns',
    docLegacy.includes(`${LEGACY.temperature}`),
    `expected ${LEGACY.temperature}`,
  );
  check(
    'document legacy fallback did NOT leak the other visit’s values',
    !docLegacy.includes(`${OBS.bpSystolic}/${OBS.bpDiastolic}`),
    'no cross-visit contamination',
  );

  // ======================= B. PAEDIATRIC WEIGHT ==========================
  // "Calculate Dosage" is disabled until a medicine is chosen, so a medicine
  // must be selected first — clicking it straight away just hangs on a
  // disabled button (which is exactly what the first version of this check
  // did).
  const openCalculator = async (visitId: string) => {
    await openFlowTab(page, child.id, visitId, 'Medications');
    // antd Select: the placeholder is a div that the combobox <input> sits on
    // top of, so both getByPlaceholder and clicking the placeholder text fail
    // ("intercepts pointer events"). Click the input inside the right select.
    const medicineSelect = page.locator('.ant-select').filter({ hasText: 'Search medicine...' }).first();
    await medicineSelect.locator('input.ant-select-input').click();
    await page.waitForTimeout(600);
    await page.locator('.ant-select-item-option').first().click();
    await page.waitForTimeout(400);
    const calcButton = page.getByRole('button', { name: /Calculate Dosage/i });
    await calcButton.waitFor({ state: 'visible', timeout: 10000 });
    await calcButton.click({ timeout: 10000 });
    await page.waitForTimeout(800);
  };

  await openCalculator(currentVisit.id);
  if (SHOTS) await page.screenshot({ path: join(OUT, 'g0-paediatric-weight-observation.png') });

  // Reading the weight box is fiddly and two earlier attempts read the WRONG
  // input, which is worse than failing: `.ant-input-number-input` first() hits
  // Quantity, and `.ant-col` filtered by "Weight (kg)" also matches the outer
  // layout column that contains the whole tab — its first number input is
  // Quantity again (it reported "1"). Anchor on the label itself and take the
  // very next input in document order.
  const weightBox = (p: Page) => p.locator('xpath=//*[text()="Weight (kg)"]/following::input[1]');
  const seededWeight = await weightBox(page).inputValue();
  check(
    'calculator: weight seeded from the latest observation',
    Number(seededWeight) === OBS.weight,
    `field shows "${seededWeight}", expected ${OBS.weight}`,
  );

  const bodyNow = await page.locator('body').innerText();
  check(
    'calculator: correct patient/visit context',
    bodyNow.includes('Paediatric Patient'),
    'paediatric patient record is the one open',
  );

  await openCalculator(legacyVisit.id);
  if (SHOTS) await page.screenshot({ path: join(OUT, 'g0-paediatric-weight-legacy.png') });
  const legacyWeight = await weightBox(page).inputValue();
  check(
    'calculator legacy fallback: weight from the frozen note columns',
    Number(legacyWeight) === LEGACY.weight,
    `field shows "${legacyWeight}", expected ${LEGACY.weight}`,
  );
  check(
    'calculator legacy fallback did NOT use the other visit’s weight',
    Number(legacyWeight) !== OBS.weight,
    'no cross-visit contamination',
  );

  await context.close();
  await browser.close();
}

main()
  .then(() => {
    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    if (failed.length > 0) process.exitCode = 1;
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await ledger?.cleanup();
    await prisma.$disconnect();
  });
