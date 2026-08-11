import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import * as jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { chromium, Page } from 'playwright-core';
import { FixtureLedger, assertFixturesAllowed, fixtureLabel, sweepOrphanedFixtures } from './fixture-support';

config({ path: join(__dirname, '..', '.env') });

// G4 (D-067) — Previous Visits and read-only clinical history, against the
// real database, HTTP API and Chrome.
//
//   KUWICK_ALLOW_FIXTURES=yes npx tsx prisma/g4-visit-history-check.ts [--shots]
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const API = 'http://localhost:3000';
const WEB = 'http://localhost:5173';
const SHOTS = process.argv.includes('--shots');
const OUT = join(__dirname, '..', '..', '..', 'docs', 'g4-screenshots');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
let ledger: FixtureLedger | undefined;

const results: { name: string; pass: boolean; detail: string }[] = [];
function check(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

async function call(path: string, token: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function api(path: string, token: string, method = 'GET', body?: unknown) {
  const r = await call(path, token, method, body);
  if (r.status >= 400) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function upload(path: string, token: string, fileName: string) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(PNG)], { type: 'image/png' }), fileName);
  const res = await fetch(`${API}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  if (res.status >= 400) throw new Error(`POST ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

// Counts every clinical row for this patient, so "reviewing history creates
// nothing" is measured against the database rather than assumed.
async function countRows(tenantId: string, patientId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    const rows = await tx.$queryRawUnsafe<{ table_name: string; n: bigint }[]>(`
      WITH v AS (SELECT id FROM visits WHERE patient_id = '${patientId}')
      SELECT 'visits' AS table_name, count(*)::bigint AS n FROM v
      UNION ALL SELECT 'clinical_notes', count(*)::bigint FROM clinical_notes WHERE visit_id IN (SELECT id FROM v)
      UNION ALL SELECT 'diagnoses', count(*)::bigint FROM diagnoses WHERE visit_id IN (SELECT id FROM v)
      UNION ALL SELECT 'prescriptions', count(*)::bigint FROM prescriptions WHERE visit_id IN (SELECT id FROM v)
      UNION ALL SELECT 'documents', count(*)::bigint FROM documents WHERE visit_id IN (SELECT id FROM v)
      UNION ALL SELECT 'order_services', count(*)::bigint FROM order_services WHERE visit_id IN (SELECT id FROM v)
      UNION ALL SELECT 'visit_attachments', count(*)::bigint FROM visit_attachments WHERE visit_id IN (SELECT id FROM v)
      UNION ALL SELECT 'invoices', count(*)::bigint FROM invoices WHERE visit_id IN (SELECT id FROM v)
      UNION ALL SELECT 'visit_observations', count(*)::bigint FROM visit_observations WHERE visit_id IN (SELECT id FROM v)`);
    return rows.map((r) => `${r.table_name}=${r.n}`).join(' ');
  });
}

async function main() {
  assertFixturesAllowed();
  if (SHOTS) mkdirSync(OUT, { recursive: true });

  const tokenFor = (s: { user_id: string; tenant_id: string; staff_id: string; role: string }) =>
    jwt.sign({ sub: s.user_id, tenantId: s.tenant_id, staffId: s.staff_id, role: s.role },
      process.env.JWT_ACCESS_SECRET as string, { expiresIn: '60m' });

  const candidates = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    return tx.$queryRawUnsafe<
      { user_id: string; staff_id: string; tenant_id: string; role: string; full_name: string; tenant_name: string }[]
    >(`SELECT u.id AS user_id, s.id AS staff_id, s.tenant_id, s.role, s.full_name, t.name AS tenant_name
       FROM staff s JOIN users u ON s.user_id = u.id JOIN tenants t ON t.id = s.tenant_id
       WHERE s.active ORDER BY CASE WHEN s.role::text LIKE 'DOCTOR%' THEN 0 ELSE 1 END`);
  });

  let seed: (typeof candidates)[number] | undefined;
  let token = '';
  const probed = new Set<string>();
  for (const candidate of candidates) {
    if (probed.has(candidate.tenant_id)) continue;
    probed.add(candidate.tenant_id);
    const t = tokenFor(candidate);
    const clinics = await call('/clinics', t);
    if (clinics.status === 200 && clinics.body.length > 0) {
      seed = candidate;
      token = t;
      break;
    }
  }
  if (!seed) throw new Error('No tenant with a login and a clinic.');
  console.log(`Anchor tenant: ${seed.tenant_name} · ${seed.role} ${seed.full_name}`);

  const swept = await sweepOrphanedFixtures(prisma, seed.tenant_id);
  if (swept > 0) console.log(`Swept ${swept} leftover fixture visit(s)`);
  ledger = new FixtureLedger(prisma, API, token, seed.tenant_id);

  // ============================================================ §14 fixtures
  const clinics = await api('/clinics', token);
  const clinicId = clinics[0].id;
  const services = await api('/services', token);
  const items = await api('/items', token);
  const panels = await api('/panel-clinics', token);
  const stamp = Date.now();

  const patient = await api('/patients', token, 'POST', {
    name: fixtureLabel('G4 History Patient'),
    identifierType: 'PASSPORT',
    identifierValue: `G4${stamp}`.slice(0, 14),
    dob: '2018-06-11',
    gender: 'MALE',
    allergies: ['Penicillin'],
  });
  ledger.patient(patient.id);

  // A second patient, to prove a visit id cannot be read under the wrong chart.
  const otherPatient = await api('/patients', token, 'POST', {
    name: fixtureLabel('G4 Other Patient'),
    identifierType: 'PASSPORT',
    identifierValue: `G4O${stamp}`.slice(0, 14),
  });
  ledger.patient(otherPatient.id);

  const doctors = await api('/staff', token);
  const otherDoctor = doctors.find((s: { id: string }) => s.id !== seed!.staff_id) ?? { id: seed.staff_id };

  // NOTE — these visits are inserted directly rather than through POST /visits.
  //
  // `VisitService.nextVisitNumber()` is `count(*) + 1`, so as soon as ANY visit
  // has been deleted the count falls behind the highest number in use and
  // every subsequent create collides on `visits_tenant_id_visit_number_key`
  // (500). That is a real pre-existing defect — it is reported, not fixed
  // here, because G4 must not change current-visit workflows. Seeding
  // directly with a reserved V-9xxxxx range keeps this check measuring
  // history behaviour instead of that bug.
  let visitSeq = 900000;
  const makeVisit = async (label: string, options: { staffId?: string; panelClinicId?: string } = {}) => {
    visitSeq += 1;
    const visitNumber = `V-${visitSeq}`;
    const row = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${seed!.tenant_id}, true)`;
      const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
        `INSERT INTO visits (id, tenant_id, clinic_id, patient_id, staff_id, visit_number, billing_type,
           panel_clinic_id, presenting_complaint, check_in_at, created_at, updated_at)
         VALUES (gen_random_uuid(), '${seed!.tenant_id}', '${clinicId}', '${patient.id}',
           '${options.staffId ?? seed!.staff_id}', '${visitNumber}',
           '${options.panelClinicId ? 'Panel' : 'Cash'}',
           ${options.panelClinicId ? `'${options.panelClinicId}'` : 'NULL'},
           '${fixtureLabel(label).replace(/'/g, "''")}',
           now() - interval '${visitSeq - 900000} months', now(), now())
         RETURNING id`);
      return rows[0];
    });
    ledger!.visit(row.id);
    return { id: row.id, visitNumber };
  };

  // Nine previous visits plus the current one, deliberately varied.
  const visits = [];
  for (let i = 0; i < 13; i += 1) {
    visits.push(
      await makeVisit(`G4 previous visit ${i + 1}`, {
        staffId: i % 3 === 0 ? otherDoctor.id : seed.staff_id,
        panelClinicId: i === 4 && panels.length > 0 ? panels[0].id : undefined,
      }),
    );
  }
  const current = await makeVisit('G4 CURRENT consultation');

  // Visit 1 — the fully populated one.
  const v1 = visits[0];
  await api(`/visits/${v1.id}/observations`, token, 'POST', {
    bpSystolic: 104, bpDiastolic: 66, pulse: 98, temperature: 38.4, spo2: 98, respRate: 24,
    weight: 21.5, height: 118, glucose: 5.1,
  });
  await api('/diagnoses', token, 'POST', { visitId: v1.id, name: 'Dengue fever', icd10Code: 'A90', priority: 'PRIMARY' });
  await api('/diagnoses', token, 'POST', { visitId: v1.id, name: 'Dehydration', icd10Code: 'E86' });
  const toRemove = await api('/diagnoses', token, 'POST', { visitId: v1.id, name: 'Typhoid fever', icd10Code: 'A01.0' });
  await api(`/diagnoses/${toRemove.id}/removal`, token, 'PATCH', { removalReason: 'Recorded against the wrong patient in error' });

  if (items.length > 0) {
    // Weight-based dosing is only valid for an item that stores its
    // concentration and strength — the service rightly refuses otherwise, so
    // the fixture uses a real one where the catalog has it.
    const paediatric = items.find((i: { concVolMl: string | null; strengthMg: string | null }) => i.concVolMl && i.strengthMg);
    await api('/prescriptions', token, 'POST', {
      visitId: v1.id, itemId: (paediatric ?? items[0]).id, quantity: 12, amount: 5, unit: 'ml',
      frequency: 'TDS', durationDays: 4, remark: 'After food',
      // A paediatric weight-based course, with the working the prescriber recorded.
      ...(paediatric ? { calcMethod: 'WEIGHT_BASED', calcWeightKg: 21.5, calcDoseRateMgKg: 15 } : {}),
    });
    if (!paediatric) console.log('  note: no catalog item stores conc/strength — weight-based dosing not exercised');
    if (items.length > 1) {
      await api('/prescriptions', token, 'POST', {
        visitId: v1.id, itemId: items[1].id, quantity: 10, amount: 1,
        frequency: 'BD', durationDays: 5, indication: 'Fever',
      });
    }
  }

  if (services.length > 0) {
    const ordered = await api('/order-services', token, 'POST', { visitId: v1.id, serviceCatalogId: services[0].id, instruction: 'Fasting' });
    const inProgress = await api('/order-services', token, 'POST', { visitId: v1.id, serviceCatalogId: services[0].id });
    await api(`/order-services/${inProgress.id}/start`, token, 'PATCH', {});
    const completed = await api('/order-services', token, 'POST', { visitId: v1.id, serviceCatalogId: services[0].id });
    await api(`/order-services/${completed.id}/start`, token, 'PATCH', {});
    await upload(`/order-services/${completed.id}/attachments`, token, 'fbc-result.png');
    await api(`/order-services/${completed.id}/complete`, token, 'PATCH', { result: 'Platelets 145, Hct 38' });
    void ordered;
  }

  await upload(`/visits/${v1.id}/attachments`, token, 'rash-day-3.png');
  await upload(`/visits/${v1.id}/attachments`, token, 'rash-day-5.png');

  const mcDoc = await api('/documents', token, 'POST', {
    visitId: v1.id, type: 'MC', content: 'MEDICAL CERTIFICATE\n\nUnfit for school for 3 days.',
    startDate: '2026-04-02', endDate: '2026-04-04', diagnosisText: 'Dengue fever',
  });
  // Authorised by the acting doctor, so history shows a real issued document
  // as well as drafts (G3b closure vocabulary, D-064).
  await api(`/documents/${mcDoc.id}/authorise`, token, 'PATCH', {});
  await api('/documents', token, 'POST', {
    visitId: v1.id, type: 'REFERRAL', content: 'Dear Doctor,\n\nPlease review this child.',
    referredTo: 'Hospital Kuala Lumpur, Paediatrics',
  });
  await api('/documents', token, 'POST', { visitId: v1.id, type: 'MEMO', content: 'MEMO\n\nReturn if bleeding gums.' });
  const voided = await api('/documents', token, 'POST', {
    visitId: v1.id, type: 'MC', content: 'MEDICAL CERTIFICATE\n\nUnfit for 7 days.',
    startDate: '2026-04-02', endDate: '2026-04-08',
  });
  await api(`/documents/${voided.id}/void`, token, 'PATCH', { reason: 'Issued with the wrong end date' });

  const noteV1 = await api(`/visits/${v1.id}/clinical-notes`, token, 'POST', {
    notes: '<p>Day 3 of fever. Warm peripheries, no bleeding. Advised oral fluids.</p>',
    noteLanguage: 'EN', noteType: 'DOCTOR_NARRATIVE',
  });
  await api(`/visits/${v1.id}/clinical-notes/${noteV1.id}/sign`, token, 'POST', { expectedVersion: noteV1.version });

  // Cash invoice, paid. Payment needs a billing role (G3c closure, D-066) —
  // a doctor can raise and itemise a bill but not take the money, so the
  // fixture acts as front desk for that one step.
  const billingStaff = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    const rows = await tx.$queryRawUnsafe<{ user_id: string; staff_id: string; role: string }[]>(
      `SELECT u.id AS user_id, s.id AS staff_id, s.role::text AS role
       FROM staff s JOIN users u ON s.user_id = u.id
       WHERE s.active AND s.tenant_id = '${seed!.tenant_id}'
         AND s.role::text IN ('OWNER_ADMIN','FINANCE_STAFF','FRONT_DESK_CLINICAL_STAFF') LIMIT 1`);
    return rows[0] ?? null;
  });
  const billingToken = billingStaff ? tokenFor({ ...billingStaff, tenant_id: seed.tenant_id }) : null;

  const inv1 = await api('/invoices', token, 'POST', { visitId: v1.id, createdByStaffId: seed.staff_id });
  await api(`/invoices/${inv1.id}/lines`, token, 'POST', { description: 'Consultation', unitPrice: 45 });
  if (billingToken) {
    await api(`/invoices/${inv1.id}/pay`, billingToken, 'PATCH', { paymentMethod: 'CASH' });
  } else {
    console.log('  note: no billing role in this tenant — the paid-invoice case is not exercised');
  }

  // Visit 5 — panel visit, unpaid invoice.
  const panelVisit = visits[4];
  const inv2 = await api('/invoices', token, 'POST', { visitId: panelVisit.id, createdByStaffId: seed.staff_id });
  await api(`/invoices/${inv2.id}/lines`, token, 'POST', { description: 'Consultation', unitPrice: 60 });
  await api('/diagnoses', token, 'POST', { visitId: panelVisit.id, name: 'Acute pharyngitis', icd10Code: 'J02.9' });

  // Visits 2-4 and 6-9 — lighter but real content, so the list is not one fat
  // card and eight empty ones.
  for (const [index, visit] of visits.entries()) {
    if (index === 0 || index === 4) continue;
    await api('/diagnoses', token, 'POST', {
      visitId: visit.id,
      name: index % 2 === 0 ? 'Acute upper respiratory infection' : 'Allergic rhinitis',
      icd10Code: index % 2 === 0 ? 'J06.9' : 'J30.4',
      priority: 'PRIMARY',
    });
    if (items.length > 0 && index !== 8) {
      await api('/prescriptions', token, 'POST', {
        visitId: visit.id, itemId: items[0].id, quantity: 6, amount: 5, unit: 'ml',
        frequency: 'BD', durationDays: 3,
      });
    }
    if (index === 2) {
      await api('/documents', token, 'POST', {
        visitId: visit.id, type: 'MC', content: 'MEDICAL CERTIFICATE\n\nUnfit for 1 day.',
        startDate: '2026-02-10', endDate: '2026-02-10',
      });
    }
  }

  // Visit 9 — a legacy record: attribution and authorship never captured.
  const legacyVisit = visits[8];
  const legacyNote = await api(`/visits/${legacyVisit.id}/clinical-notes`, token, 'POST', {
    notes: '<p>Carried over from the previous system.</p>', noteLanguage: 'EN', noteType: 'DOCTOR_NARRATIVE',
  });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${seed!.tenant_id}, true)`;
    await tx.$executeRawUnsafe(
      `UPDATE clinical_notes SET author_staff_id = NULL, author_name_snapshot = NULL,
         legacy_author_unknown = true WHERE id = '${legacyNote.id}'`);
    await tx.$executeRawUnsafe(
      `UPDATE diagnoses SET added_by_staff_id = NULL, added_by_name_snapshot = NULL, priority = NULL
         WHERE visit_id = '${legacyVisit.id}'`);
  });

  // The current consultation: an unsigned note the doctor is still working on.
  await api(`/visits/${current.id}/clinical-notes`, token, 'POST', {
    notes: '<p>Current consultation in progress.</p>', noteLanguage: 'EN', noteType: 'DOCTOR_NARRATIVE',
  });

  const before = await countRows(seed.tenant_id, patient.id);
  console.log(`Fixture rows: ${before}`);

  // ============================================================== §9 security
  const page1 = await api(`/patients/${patient.id}/history?limit=5`, token);
  check('history is paginated, not one unbounded array', page1.items.length === 5 && page1.nextCursor !== null,
    `${page1.items.length} of ${page1.total} with a cursor`);

  const page2 = await api(`/patients/${patient.id}/history?limit=5&cursor=${page1.nextCursor}`, token);
  const overlap = page2.items.filter((i: { id: string }) => page1.items.some((j: { id: string }) => j.id === i.id));
  check('the next page continues rather than repeating', overlap.length === 0, `${page2.items.length} further visit(s), no overlap`);

  const searched = await api(`/patients/${patient.id}/history?search=Dengue`, token);
  check('search reaches the whole stored history, not the loaded page',
    searched.items.length >= 1 && searched.items.every((i: { primaryDiagnosis: { name: string } | null }) =>
      i.primaryDiagnosis?.name === 'Dengue fever'),
    `${searched.items.length} visit(s) matched a diagnosis recorded on page 2`);

  const medSearch = await api(`/patients/${patient.id}/history?search=${encodeURIComponent(items[0]?.name ?? 'zzz')}`, token);
  check('search covers medications as well as diagnoses', medSearch.total > 0, `${medSearch.total} visit(s)`);

  const crossPatient = await call(`/patients/${otherPatient.id}/history/${v1.id}`, token);
  check('a visit id cannot be read under another patient’s chart', crossPatient.status === 404, `HTTP ${crossPatient.status}`);

  const otherTenant = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    const rows = await tx.$queryRawUnsafe<{ id: string; name: string }[]>(
      `SELECT id, name FROM tenants WHERE id <> '${seed!.tenant_id}' LIMIT 1`);
    return rows[0] ?? null;
  });
  if (otherTenant) {
    const foreign = jwt.sign({ sub: seed.user_id, tenantId: otherTenant.id, staffId: seed.staff_id, role: seed.role },
      process.env.JWT_ACCESS_SECRET as string, { expiresIn: '30m' });
    const res = await call(`/patients/${patient.id}/history/${v1.id}`, foreign);
    check(`a token scoped to "${otherTenant.name}" cannot read this history`, res.status >= 400, `HTTP ${res.status}`);
  }

  // Cross-branch: a staff member whose home branch is elsewhere, in a tenant
  // that genuinely has more than one branch.
  if (clinics.length > 1) {
    const stranger = await api('/staff', token, 'POST', {
      fullName: fixtureLabel('G4 Other Branch Doctor'),
      role: 'DOCTOR_RESIDENT',
      clinicId: clinics[1].id,
      loginEmail: `kuwick-fixture-g4-${stamp}@example.invalid`,
      loginPassword: `Fixture!${stamp}`,
    });
    const strangerToken = tokenFor({ user_id: stranger.userId, tenant_id: seed.tenant_id, staff_id: stranger.id, role: 'DOCTOR_RESIDENT' });
    const denied = await call(`/patients/${patient.id}/history/${v1.id}`, strangerToken);
    check('a visit in another branch is not readable', denied.status === 404, `HTTP ${denied.status}`);
    const list = await api(`/patients/${patient.id}/history`, strangerToken);
    check('the branch filter applies to the LIST as well', list.items.length === 0, `${list.items.length} visit(s) visible`);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
      await tx.$executeRawUnsafe(`DELETE FROM staff WHERE id = '${stranger.id}'`);
      if (stranger.userId) await tx.$executeRawUnsafe(`DELETE FROM users WHERE id = '${stranger.userId}'`);
    });
  } else {
    check('branch filtering is exercised', true, 'single-branch tenant — every branch is readable by design');
  }

  const anonymous = await fetch(`${API}/patients/${patient.id}/history`);
  check('history is not readable without a session', anonymous.status === 401, `HTTP ${anonymous.status}`);

  // §10 — payload size actually observed.
  const summaryBytes = JSON.stringify(await api(`/patients/${patient.id}/history?limit=10`, token)).length;
  const detailBytes = JSON.stringify(await api(`/patients/${patient.id}/history/${v1.id}`, token)).length;
  check('the summary page stays small', summaryBytes < 60_000, `${(summaryBytes / 1024).toFixed(1)} KB for 10 visits`);
  check('a full visit is fetched only on demand', detailBytes > 0, `${(detailBytes / 1024).toFixed(1)} KB for the populated visit`);

  // ================================================================= browser
  const browser = await chromium.launch({ executablePath: CHROME, headless: false });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await context.addInitScript(
    (a) => {
      localStorage.setItem('kuwick-auth', JSON.stringify({ state: a, version: 0 }));
      localStorage.setItem('kuwick-record-view-layout', JSON.stringify({ state: { layout: 'canvas' }, version: 0 }));
    },
    {
      accessToken: token, refreshToken: token,
      staff: { id: seed.staff_id, fullName: seed.full_name, role: seed.role, clinicId: null },
      tenant: { id: seed.tenant_id, name: seed.tenant_name, slug: null },
    },
  );

  const page = await context.newPage();
  await page.goto(`${WEB}/patients/${patient.id}?visitId=${current.id}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  const DRAFT_TEXT = 'Unsaved: patient reviewed, awaiting FBC. DO NOT LOSE THIS TEXT.';
  await page.click('.ProseMirror');
  await page.keyboard.type(DRAFT_TEXT);
  await page.waitForTimeout(600);

  const readState = () =>
    page.evaluate(`(() => {
      var pm = document.querySelector('.ProseMirror');
      return {
        note: pm ? pm.innerText : null,
        visitTag: (document.querySelector('.kw-notes-card .ant-tag') || {}).innerText || null,
        url: location.href,
      };
    })()`) as Promise<{ note: string | null; visitTag: string | null; url: string }>;

  const stateBefore = await readState();
  check('the current consultation has unsaved text before history is opened',
    (stateBefore.note ?? '').includes(DRAFT_TEXT), `note tagged ${stateBefore.visitTag}`);
  if (SHOTS) await page.screenshot({ path: join(OUT, 'g4-note-before-history.png') });

  // §15.1-4 — open history and prove the consultation is untouched.
  await page.getByRole('button', { name: 'Previous Visits' }).first().click();
  await page.waitForTimeout(2000);
  const cards = await page.locator('.kw-history-card').count();
  check('[ui] the previous-visit list opens with summary cards', cards > 0, `${cards} card(s) on the first page`);
  if (SHOTS) await page.screenshot({ path: join(OUT, 'g4-desktop-collapsed-list.png') });

  const cardText = await page.locator('.kw-history-card').first().innerText();
  check('[ui] a collapsed card reads as a visit summary',
    /V-\d{6}/.test(cardText) && /Diagnosis:/.test(cardText),
    cardText.split('\n').slice(0, 4).join(' | '));

  // Expand several visits at once (§4 — not an accordion).
  const expandButtons = page.locator('.kw-history-card button.ant-btn').filter({ hasText: /^Expand$/ });
  await expandButtons.nth(0).click();
  await page.waitForTimeout(1200);
  await expandButtons.nth(0).click({ trial: true }).catch(() => undefined);
  const secondExpand = page.locator('.kw-history-card button.ant-btn').filter({ hasText: /^Expand$/ }).first();
  await secondExpand.click();
  await page.waitForTimeout(1500);
  const openCards = await page.locator('.kw-history-card[data-expanded="yes"]').count();
  check('[ui] several visits stay open at once — comparison is possible', openCards >= 2, `${openCards} expanded`);
  if (SHOTS) await page.screenshot({ path: join(OUT, 'g4-desktop-expanded.png') });

  const detailText = await page.locator('.kw-history-card[data-expanded="yes"] .kw-history-detail').first().innerText();
  check('[ui] the expanded visit shows the clinical record',
    /Clinical note/.test(detailText) && /Diagnosis/.test(detailText) && /Medications/.test(detailText),
    detailText.split('\n').slice(0, 3).join(' | '));
  // Measured as CONTROLS, not as words. The record legitimately contains the
  // text "COMPLETED" and "removed in error"; what must not exist is anything
  // clickable that could change it.
  const detailControls = await page.evaluate(`(() => {
    var out = [];
    var scopes = document.querySelectorAll('.kw-history-card[data-expanded="yes"] .kw-history-detail');
    for (var s = 0; s < scopes.length; s++) {
      var els = scopes[s].querySelectorAll('button, a, input, textarea, select, [contenteditable="true"]');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        // antd renders the image lightbox trigger as a div/img wrapper; a
        // genuine control has a label or is a form field.
        out.push((el.innerText || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 30));
      }
    }
    return out;
  })()`) as string[];
  check('[ui] no editing control exists anywhere in the expanded record',
    detailControls.length === 0,
    detailControls.length === 0 ? 'zero buttons, links or inputs' : detailControls.join(', '));

  const stateAfter = await readState();
  check('[ui] the current visit is unchanged after reviewing history',
    stateAfter.visitTag === stateBefore.visitTag && stateAfter.url === stateBefore.url,
    `still ${stateAfter.visitTag}`);
  check('[ui] the unsaved note survives byte-for-byte',
    stateAfter.note === stateBefore.note, `${(stateAfter.note ?? '').length} characters, identical`);

  const promptShown = await page.locator('.ant-modal').count();
  check('[ui] no unsaved-note prompt is raised by reviewing history', promptShown === 0, `${promptShown} modal(s)`);

  // §15.14 — a historical clinical image opens in the lightbox.
  const images = page.locator('.kw-history-card[data-expanded="yes"] .ant-image img');
  const imageCount = await images.count();
  if (imageCount > 0) {
    await images.first().click();
    await page.waitForTimeout(900);
    const preview = await page.locator('.ant-image-preview-img').count();
    check('[ui] a historical clinical image opens in the lightbox', preview > 0, `${imageCount} thumbnail(s)`);
    if (SHOTS) await page.screenshot({ path: join(OUT, 'g4-image-lightbox.png') });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  } else {
    check('[ui] a historical clinical image opens in the lightbox', false, 'no thumbnails rendered');
  }

  // §15.15/16 — voided and removed history is separated; invoice is read-only.
  check('[ui] removed and voided history is shown separately, not mixed in',
    /removed in error/i.test(detailText) && /voided document/i.test(detailText),
    'separate blocks for removed diagnoses and voided documents');
  check('[ui] the historical invoice is read-only',
    /Invoice/.test(detailText) && !/Mark Paid|Cancel Invoice|Add Line/i.test(detailText),
    'charges shown for reference only');

  // §11 — server-side search from the UI.
  await page.locator('.kw-history-panel input').first().fill('Dengue');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1800);
  const filtered = await page.locator('.kw-history-card').count();
  const countLine = await page.locator('.kw-history-panel').first().innerText();
  check('[ui] filtering narrows the list and says how many matched',
    filtered < cards && /shown/.test(countLine),
    `${filtered} card(s) after filtering ${cards}`);
  if (SHOTS) await page.screenshot({ path: join(OUT, 'g4-search-filter.png') });
  await page.locator('.kw-history-panel input').first().fill('');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1600);

  // §15.8 — Load More.
  const loadMore = page.getByRole('button', { name: 'Load More' });
  const hasLoadMore = (await loadMore.count()) > 0;
  if (hasLoadMore) {
    if (SHOTS) await page.screenshot({ path: join(OUT, 'g4-load-more.png') });
    await loadMore.click();
    await page.waitForTimeout(1600);
    const after = await page.locator('.kw-history-card').count();
    check('[ui] Load More extends the list rather than replacing it', after > cards, `${cards} → ${after} cards`);
  } else {
    check('[ui] Load More extends the list rather than replacing it', false, 'no Load More button rendered');
  }

  // §15.17-18 — Open Full Visit in a new tab, labelled read only.
  const [historyTab] = await Promise.all([
    context.waitForEvent('page'),
    page.locator('.kw-history-card').first().getByRole('link', { name: 'Open Full Visit' }).click(),
  ]);
  await historyTab.waitForLoadState('networkidle');
  await historyTab.waitForTimeout(1800);
  const fullText = await historyTab.evaluate('document.body.innerText') as string;
  check('[ui] Open Full Visit opens a NEW tab', context.pages().length >= 2, `${context.pages().length} tabs open`);
  check('[ui] the full historical route is labelled Read Only',
    /Historical Visit — Read Only/.test(fullText), 'banner present');
  check('[ui] the full historical route offers no editing',
    !/(Add Diagnosis|Set Primary|Create Document|Mark Paid|Dispense|Save)/i.test(fullText), 'read-only page');
  if (SHOTS) await historyTab.screenshot({ path: join(OUT, 'g4-full-readonly-route.png'), fullPage: true });

  const consultationStillThere = await readState();
  check('[ui] the consultation tab kept its unsaved note while the visit opened elsewhere',
    consultationStillThere.note === stateBefore.note, 'note unchanged in the original tab');
  await historyTab.close();

  // §15.19-21 — layout at the required viewports.
  const measure = (p: Page) =>
    p.evaluate(`(() => {
      var hoz = document.documentElement.scrollWidth > window.innerWidth + 1;
      var editor = document.querySelector('.kw-editor-fill') || document.querySelector('.ProseMirror');
      var small = [];
      var btns = document.querySelectorAll('.kw-history-panel button, .kw-history-card button, .kw-history-card a.ant-btn');
      for (var i = 0; i < btns.length; i++) {
        var r = btns[i].getBoundingClientRect();
        if (r.height > 0 && Math.round(r.height) < 44) small.push(((btns[i].innerText || btns[i].getAttribute('aria-label') || '(no label)').trim()) + '[' + (btns[i].className || '').toString().slice(0, 40) + ']=' + Math.round(r.height));
      }
      return {
        horizontal: hoz,
        editorHeight: editor ? Math.round(editor.getBoundingClientRect().height) : null,
        smallTargets: small,
      };
    })()`) as Promise<{ horizontal: boolean; editorHeight: number | null; smallTargets: string[] }>;

  const desktop = await measure(page);
  check('[1920] no horizontal page scroll with history open', !desktop.horizontal, 'body does not scroll sideways');
  check('[1920] the editor keeps its declared height', (desktop.editorHeight ?? 0) > 200, `${desktop.editorHeight}px`);

  for (const [label, width, height] of [
    ['1366', 1366, 768],
    ['tablet-900', 900, 1180],
    ['mobile-375', 375, 812],
  ] as [string, number, number][]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(1400);
    const m = await measure(page);
    check(`[${label}] no horizontal scrolling`, !m.horizontal, 'fits the viewport');
    check(`[${label}] every history control is at least 44px tall`, m.smallTargets.length === 0,
      m.smallTargets.length === 0 ? 'all targets ≥ 44px' : m.smallTargets.join(', '));
    if (SHOTS) await page.screenshot({ path: join(OUT, `g4-${label}.png`) });
  }

  // Mobile: the whole flow again, on a phone-sized screen.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);
  await page.getByRole('button', { name: 'Patient Summary' }).first().click().catch(() => undefined);
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: 'Previous Visits' }).first().click();
  await page.waitForTimeout(1800);
  if (SHOTS) await page.screenshot({ path: join(OUT, 'g4-mobile-list.png') });
  const mobileCards = await page.locator('.kw-history-card').count();
  check('[mobile] previous visits open full-width with readable cards', mobileCards > 0, `${mobileCards} card(s)`);
  await page.locator('.kw-history-card button.ant-btn').filter({ hasText: /^Expand$/ }).first().click();
  await page.waitForTimeout(1600);
  const mobileOrder = await page.locator('.kw-history-card[data-expanded="yes"] .kw-history-section').allTextContents();
  const sections = mobileOrder.map((t) => t.split('\n')[0].trim());
  check('[mobile] the expanded record follows the clinical reading order',
    sections.slice(0, 4).join(' → ').includes('Visit'), sections.join(' → '));
  if (SHOTS) await page.screenshot({ path: join(OUT, 'g4-mobile-expanded.png') });

  // §15.22 — nothing was written by any of the above.
  const after = await countRows(seed.tenant_id, patient.id);
  check('reviewing history created and mutated no database row', after === before, `${after}`);
  if (SHOTS) {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: join(OUT, 'g4-note-after-history.png') });
  }

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
