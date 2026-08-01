import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import { chromium } from 'playwright-core';

config({ path: join(__dirname, '..', '.env') });

// C0 closure (D-051) — capture the review screenshots as real PNG files.
//
// Drives the locally-installed Chrome (playwright-core downloads no browser),
// authenticates through the real login endpoint, seeds SAFE TEST DATA only
// (a clearly-labelled review patient — never a real record), and exercises
// each state the owner asked to see.
//
// Run with the web + api dev servers up:
//   npx tsx prisma/c0-review-screenshots.ts
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const API = 'http://localhost:3000';
const WEB = 'http://localhost:5173';
const OUT = join(__dirname, '..', '..', '..', 'docs', 'c0-screenshots');

const EMAIL = process.env.C0_SHOT_EMAIL ?? 'amira.rahman@smoke-test-clinic.test';
const PASSWORD = process.env.C0_SHOT_PASSWORD;

async function api(path: string, token: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function main() {
  if (!PASSWORD) {
    throw new Error('Set C0_SHOT_PASSWORD (the dev clinic login password) before running.');
  }
  mkdirSync(OUT, { recursive: true });

  // --- authenticate through the real endpoint -------------------------------
  const loginRes = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!loginRes.ok) {
    throw new Error(`Login failed: ${loginRes.status} ${await loginRes.text()}`);
  }
  const auth = await loginRes.json();
  const token: string = auth.accessToken;

  // --- SAFE TEST DATA: a clearly-labelled review patient --------------------
  const stamp = Date.now();
  const patient = await api('/patients', token, 'POST', {
    name: `ZZ C0 Review Patient ${stamp}`,
    identifierType: 'NRIC',
    identifierValue: `C0${stamp}`.slice(0, 14),
  });
  const clinics = await api('/clinics', token);
  const visit = await api('/visits', token, 'POST', {
    patientId: patient.id,
    clinicId: clinics[0].id,
    staffId: auth.staff.id,
    billingType: 'Self-pay',
    presentingComplaint: 'Review scenario — fever',
  });

  // Observation recorded, then corrected (gives us correction history).
  const obs = await api(`/visits/${visit.id}/observations`, token, 'POST', {
    bpSystolic: 220, bpDiastolic: 110, pulse: 88, temperature: 38.2, spo2: 97, weight: 62.5, height: 168,
  });
  await api(`/visits/${visit.id}/observations/${obs.id}`, token, 'PATCH', {
    bpSystolic: 122, bpDiastolic: 78, pulse: 88, temperature: 38.2, spo2: 97, weight: 62.5, height: 168,
    expectedVersion: obs.version, correctionReason: 'BP transcribed incorrectly at triage',
  });

  // A draft note, and a separate note that gets signed then amended.
  await api(`/visits/${visit.id}/clinical-notes`, token, 'POST', {
    notes: '<p>Review draft: patient reports fever for 3 days, no red flags.</p>',
  });
  const toSign = await api(`/visits/${visit.id}/clinical-notes`, token, 'POST', {
    notes: '<p>Impression: viral URTI. Symptomatic treatment advised.</p>',
  });
  const signed = await api(`/visits/${visit.id}/clinical-notes/${toSign.id}/sign`, token, 'POST', {
    expectedVersion: toSign.version,
  });
  await api(`/visits/${visit.id}/clinical-notes/${toSign.id}/amend`, token, 'POST', {
    amendmentReason: 'Temperature corrected after re-check',
    notes: '<p>Addendum: temperature re-checked at 38.2°C, not afebrile as first recorded.</p>',
  });

  const notes = await api(`/visits/${visit.id}/clinical-notes`, token);
  const draft = notes.find((n: { status: string; entryType: string }) => n.status === 'DRAFT' && n.entryType === 'STANDARD');
  const amendment = notes.find((n: { entryType: string }) => n.entryType === 'AMENDMENT');

  // A legacy note from the pre-C0 data, if this environment has one. Located
  // via the visits list rather than a per-patient route, so it works against
  // any database that carries pre-C0 history.
  const legacy = await (async () => {
    const visits = await api('/visits', token).catch(() => []);
    for (const v of visits.slice(0, 60)) {
      const ns = await api(`/visits/${v.id}/clinical-notes`, token).catch(() => []);
      const hit = ns.find((n: { legacyAuthorUnknown: boolean }) => n.legacyAuthorUnknown);
      if (hit) return { patientId: v.patientId, visitId: v.id, noteId: hit.id };
    }
    return null;
  })();

  // --- drive the UI ---------------------------------------------------------
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  // Seed the auth store + Canvas layout the same way the app does.
  await context.addInitScript(
    ([a, t]) => {
      localStorage.setItem('kuwick-auth', JSON.stringify({ state: a, version: 0 }));
      localStorage.setItem('kuwick-record-view-layout', JSON.stringify({ state: { layout: 'canvas' }, version: 0 }));
      void t;
    },
    [{ accessToken: token, refreshToken: auth.refreshToken, staff: auth.staff, tenant: auth.tenant }, ''] as const,
  );
  const page = await context.newPage();

  // The note-history selector defaults to the newest entry, so each state has
  // to be picked explicitly or every screenshot shows the same note.
  // An amendment's label ends "· Amendment · Draft", so matching on /Draft$/
  // alone silently selects the amendment and produces duplicate screenshots.
  // `exclude` keeps the plain draft and the amendment distinguishable.
  const pickNote = async (matcher: RegExp, exclude?: string) => {
    const select = page.locator('.ant-select').first();
    await select.click();
    await page.waitForTimeout(500);
    let options = page.locator('.ant-select-item-option').filter({ hasText: matcher });
    if (exclude) {
      options = options.filter({ hasNotText: exclude });
    }
    await options.first().click();
    await page.waitForTimeout(900);
  };

  const shoot = async (
    name: string,
    url: string,
    opts: { pick?: RegExp; exclude?: string; clip?: { x: number; y: number; width: number; height: number } } = {},
  ) => {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1400);
    if (opts.pick) {
      await pickNote(opts.pick, opts.exclude);
    }
    await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false, clip: opts.clip });
    console.log(`  saved ${name}.png`);
  };

  const visitUrl = `${WEB}/patients/${patient.id}?visitId=${visit.id}`;

  console.log('Capturing C0 review screenshots →', OUT);
  // Draft: neither signed nor an amendment.
  await shoot('01-doctor-authored-draft', visitUrl, { pick: /Draft$/, exclude: 'Amendment' });
  // Signed: shows "Electronically signed by …" with signer and timestamp.
  await shoot('02-signed-note-with-signer', visitUrl, { pick: /Signed by/ });
  // Amendment: linked to the signed original, carrying its reason.
  await shoot('04-amendment-linked-to-original', visitUrl, { pick: /Amendment/ });
  // Observations: recorder attribution.
  await shoot('05-staff-recorded-observations', visitUrl);
  // The correction trail, cropped to the observations strip so it reads
  // clearly rather than duplicating the full-page shot above.
  await shoot('06-observation-correction-history', visitUrl, {
    clip: { x: 32, y: 195, width: 1030, height: 145 },
  });

  if (legacy) {
    await shoot('03-legacy-read-only-note', `${WEB}/patients/${legacy.patientId}?visitId=${legacy.visitId}`, {
      pick: /legacy note/,
    });
  } else {
    console.log('  (no legacy note in this environment — 03 skipped)');
  }

  await shoot('07-professional-signing-configuration', `${WEB}/management/hr/staff`);

  await browser.close();

  console.log('\nContext for the review (IDs, so each PNG can be traced back):');
  console.log(JSON.stringify({
    patient: patient.name,
    visitId: visit.id,
    draftNoteId: draft?.id,
    signedNoteId: signed.id,
    signedBy: signed.signerNameSnapshot,
    signedAt: signed.signedAt,
    amendmentId: amendment?.id,
    amendmentSupersedes: amendment?.supersedesNoteId,
    observationId: obs.id,
    legacyNoteId: legacy?.noteId ?? null,
  }, null, 1));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
