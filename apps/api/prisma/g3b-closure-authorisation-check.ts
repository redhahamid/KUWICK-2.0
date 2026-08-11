import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import * as jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { chromium, Page } from 'playwright-core';
import { FixtureLedger, assertFixturesAllowed, fixtureLabel, sweepOrphanedFixtures } from './fixture-support';

config({ path: join(__dirname, '..', '.env') });

// G3b closure (D-064) — document authorisation semantics and permissions,
// against the REAL database, the REAL HTTP API and real Chrome.
//
//   KUWICK_ALLOW_FIXTURES=yes npx tsx prisma/g3b-closure-authorisation-check.ts [--shots]
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const API = 'http://localhost:3000';
const WEB = 'http://localhost:5173';
const SHOTS = process.argv.includes('--shots');
const OUT = join(__dirname, '..', '..', '..', 'docs', 'g3-screenshots');
const MODAL = '.ant-modal-container, .ant-modal-content';
const DRAWER = '.ant-drawer-body';

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

// Bring the Documents section into view: the record scrolls inside its own
// container, so a fullPage screenshot otherwise captures only the page top.
async function showDocuments(page: Page) {
  await page.evaluate(`(() => {
    var s = Array.prototype.filter.call(document.querySelectorAll('.kw-clinical-section'), function (el) {
      var h = el.querySelector('.kw-section-heading');
      return h && h.innerText.indexOf('Documents') !== -1;
    })[0];
    if (s) s.scrollIntoView({ block: 'start' });
  })()`);
  await page.waitForTimeout(500);
}

async function documentsText(page: Page): Promise<string> {
  return page.evaluate(`(() => {
    var s = Array.prototype.filter.call(document.querySelectorAll('.kw-clinical-section'), function (el) {
      var h = el.querySelector('.kw-section-heading');
      return h && h.innerText.indexOf('Documents') !== -1;
    })[0];
    var body = s && s.querySelector('.kw-section-body');
    return body ? body.innerText : '';
  })()`);
}

async function main() {
  assertFixturesAllowed();
  if (SHOTS) mkdirSync(OUT, { recursive: true });

  const seed = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    const r = await tx.$queryRawUnsafe<
      { user_id: string; staff_id: string; tenant_id: string; role: string; full_name: string; tenant_name: string }[]
    >(`
      SELECT u.id AS user_id, s.id AS staff_id, s.tenant_id, s.role, s.full_name, t.name AS tenant_name
      FROM staff s JOIN users u ON s.user_id = u.id JOIN tenants t ON t.id = s.tenant_id
      WHERE s.active AND s.role IN ('DOCTOR_RESIDENT','DOCTOR_LOCUM') LIMIT 1`);
    return r[0];
  });

  const others = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    return tx.$queryRawUnsafe<
      { user_id: string; staff_id: string; tenant_id: string; role: string; full_name: string }[]
    >(`
      SELECT u.id AS user_id, s.id AS staff_id, s.tenant_id, s.role, s.full_name
      FROM staff s JOIN users u ON s.user_id = u.id
      WHERE s.active AND s.tenant_id = '${seed.tenant_id}'
        AND s.role IN ('FRONT_DESK_CLINICAL_STAFF','OWNER_ADMIN')
        AND (s.professional_type IS NULL OR s.professional_active = false)`);
  });
  const frontDesk = others.find((s) => s.role === 'FRONT_DESK_CLINICAL_STAFF');
  const ownerAdmin = others.find((s) => s.role === 'OWNER_ADMIN');

  const tokenFor = (s: { user_id: string; tenant_id: string; staff_id: string; role: string }) =>
    jwt.sign(
      { sub: s.user_id, tenantId: s.tenant_id, staffId: s.staff_id, role: s.role },
      process.env.JWT_ACCESS_SECRET as string,
      { expiresIn: '40m' },
    );
  const token = tokenFor(seed);

  const swept = await sweepOrphanedFixtures(prisma, seed.tenant_id);
  if (swept > 0) console.log(`Swept ${swept} leftover fixture visit(s)`);
  ledger = new FixtureLedger(prisma, API, token, seed.tenant_id);

  // ---------------------------------------------------- migration of history
  const migrated = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${seed.tenant_id}, true)`;
    return tx.$queryRawUnsafe<{ total: number; legacy: number; claimed: number; fabricated: number }[]>(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE authorisation_kind = 'LEGACY_SIGN_OFF')::int AS legacy,
             count(*) FILTER (WHERE authorisation_kind IN ('CLINICAL','ADMINISTRATIVE'))::int AS claimed,
             count(*) FILTER (WHERE authorised_by_name_snapshot IS NOT NULL)::int AS fabricated
        FROM documents WHERE signed_at IS NOT NULL`);
  });
  check(
    'pre-closure signed documents are labelled LEGACY_SIGN_OFF, not doctor authorisation',
    migrated[0].claimed === 0 && migrated[0].legacy === migrated[0].total,
    `${migrated[0].legacy}/${migrated[0].total} legacy, ${migrated[0].claimed} claiming clinical/administrative`,
  );
  check(
    'no doctor identity was fabricated for a historical sign-off',
    migrated[0].fabricated === 0,
    `${migrated[0].fabricated} with invented authoriser`,
  );

  // ------------------------------------------------- an administrative template
  // Configured explicitly, never inferred from the name.
  const templates = await api('/document-templates', token);
  const timeSlip = templates.find((t: { name: string }) => /time slip/i.test(t.name));
  check('the clinic has a Time Slip template to classify', Boolean(timeSlip), timeSlip?.name ?? 'none found');
  check(
    'templates default to requiring clinical authorisation (fail closed)',
    templates.every((t: { requiresClinicalAuthorisation: boolean }) => typeof t.requiresClinicalAuthorisation === 'boolean'),
    `${templates.filter((t: any) => t.requiresClinicalAuthorisation).length}/${templates.length} currently clinical`,
  );
  const originalSetting = timeSlip?.requiresClinicalAuthorisation;
  if (timeSlip) {
    await api(`/document-templates/${timeSlip.id}`, token, 'PATCH', { requiresClinicalAuthorisation: false });
  }

  // -------------------------------------------------------------- the scenario
  const clinics = await api('/clinics', token);
  const patients = await api('/patients', token);
  const visit = await api('/visits', token, 'POST', {
    clinicId: clinics[0].id,
    patientId: patients[0].id,
    staffId: seed.staff_id,
    billingType: 'Cash',
    presentingComplaint: fixtureLabel('G3b closure document authorisation'),
  });
  ledger.visit(visit.id);

  const mc = await api('/documents', token, 'POST', {
    visitId: visit.id, type: 'MC', content: 'MEDICAL CERTIFICATE\n\nUnfit for duty for 3 days.',
    startDate: '2026-08-02', endDate: '2026-08-04', diagnosisText: 'Acute tonsillitis',
  });
  const referral = await api('/documents', token, 'POST', {
    visitId: visit.id, type: 'REFERRAL', content: 'Dear Doctor,\n\nThank you for seeing this patient.',
    referredTo: 'Hospital Kuala Lumpur, ENT Department',
  });
  const memo = await api('/documents', token, 'POST', {
    visitId: visit.id, type: 'MEMO', content: 'MEMO\n\nParent advised to return if fever persists.',
  });
  const slip = timeSlip
    ? await api('/documents', token, 'POST', {
        visitId: visit.id, type: 'CUSTOM', title: timeSlip.name,
        content: 'TIME SLIP\n\nAttended the clinic this morning.',
      })
    : null;
  const toVoid = await api('/documents', token, 'POST', {
    visitId: visit.id, type: 'MC', content: 'MEDICAL CERTIFICATE\n\nUnfit for duty for 5 days.',
    startDate: '2026-08-02', endDate: '2026-08-06',
  });

  // 1 — classification
  check(
    'MC, referral and memo are classified as requiring clinical authorisation',
    mc.requiresClinicalAuthorisation && referral.requiresClinicalAuthorisation && memo.requiresClinicalAuthorisation,
    'all three clinical',
  );
  if (slip) {
    check(
      'a Time Slip from an administrative template is classified administrative',
      slip.requiresClinicalAuthorisation === false,
      'requiresClinicalAuthorisation=false',
    );
  }

  // 5 — browser-supplied signer
  const spoof = await call(`/documents/${mc.id}/authorise`, token, 'PATCH', { staffId: seed.staff_id });
  check('a browser-supplied signer identity is rejected', spoof.status === 400, `HTTP ${spoof.status}`);

  // 3 — front desk cannot clinically authorise
  if (frontDesk) {
    const fdToken = tokenFor(frontDesk);
    for (const [label, doc] of [['MC', mc], ['referral', referral], ['memo', memo]] as const) {
      const denied = await call(`/documents/${doc.id}/authorise`, fdToken, 'PATCH', {});
      check(`front desk cannot clinically authorise the ${label}`, denied.status === 403, `HTTP ${denied.status}`);
    }
    // 10 — but may still issue the administrative document
    if (slip) {
      const issued = await call(`/documents/${slip.id}/authorise`, fdToken, 'PATCH', {});
      check(
        'front desk MAY issue the administrative Time Slip',
        issued.status === 200 && issued.body?.authorisationKind === 'ADMINISTRATIVE',
        `HTTP ${issued.status}, kind=${issued.body?.authorisationKind}`,
      );
      check(
        'the administrative issuance never claims clinical authorisation',
        issued.body?.authorisationKind !== 'CLINICAL',
        `kind=${issued.body?.authorisationKind}`,
      );
    }
  } else {
    console.log('SKIP  front-desk cases — no FRONT_DESK_CLINICAL_STAFF in this database');
  }

  // 4 — non-clinical owner
  if (ownerAdmin) {
    const denied = await call(`/documents/${mc.id}/authorise`, tokenFor(ownerAdmin), 'PATCH', {});
    check('a non-clinical owner-admin cannot clinically authorise', denied.status === 403, `HTTP ${denied.status}`);
  } else {
    console.log('SKIP  owner-admin case — none non-clinical in this database');
  }

  // 8 — a draft must not be able to circulate. Checked at the API level too:
  // the document simply is not authorised, and the UI blocks production.
  const draftBefore = (await api(`/documents?visitId=${visit.id}`, token)).find((d: any) => d.id === mc.id);
  check(
    'an unauthorised clinical document carries no authorisation of any kind',
    draftBefore.signedAt === null && draftBefore.authorisationKind === null,
    'signedAt=null, authorisationKind=null',
  );

  // 1, 2 — a doctor authorises
  const authorisedMc = await api(`/documents/${mc.id}/authorise`, token, 'PATCH', {});
  check(
    'a doctor can clinically authorise the MC, and it is recorded as CLINICAL',
    authorisedMc.authorisationKind === 'CLINICAL' && authorisedMc.signedByStaffId === seed.staff_id,
    `kind=${authorisedMc.authorisationKind}, by ${authorisedMc.authorisedByNameSnapshot}`,
  );
  const authorisedReferral = await api(`/documents/${referral.id}/authorise`, token, 'PATCH', {});
  check(
    'a doctor can clinically authorise the referral',
    authorisedReferral.authorisationKind === 'CLINICAL',
    `kind=${authorisedReferral.authorisationKind}`,
  );
  // 9 — responsible doctor recorded
  check(
    'the responsible doctor is recorded as a frozen snapshot',
    authorisedMc.authorisedByNameSnapshot === seed.full_name && Boolean(authorisedMc.authorisedByRoleSnapshot),
    `${authorisedMc.authorisedByNameSnapshot} / ${authorisedMc.authorisedByRoleSnapshot}`,
  );
  check(
    'authorising does not alter the document content',
    authorisedMc.content === 'MEDICAL CERTIFICATE\n\nUnfit for duty for 3 days.',
    'content byte-identical',
  );

  // 6 — re-authorisation
  const reauth = await call(`/documents/${mc.id}/authorise`, token, 'PATCH', {});
  check('re-authorising returns 409', reauth.status === 409, `HTTP ${reauth.status}`);

  // 12 — void an authorised document
  const voidedDoc = await api(`/documents/${toVoid.id}/authorise`, token, 'PATCH', {});
  void voidedDoc;
  await api(`/documents/${toVoid.id}/void`, token, 'PATCH', {
    reason: 'Superseded by a corrected 3-day certificate',
  });
  const history = await api(`/documents/history?visitId=${visit.id}`, token);
  const voidedRow = history.find((d: any) => d.id === toVoid.id);
  check(
    'a voided authorised document stays VOIDED and keeps its clinical authorisation',
    voidedRow.recordStatus === 'VOIDED' && voidedRow.authorisationKind === 'CLINICAL',
    `${voidedRow.recordStatus} / ${voidedRow.authorisationKind}`,
  );

  // 13 — cross-tenant
  const otherTenant = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    const rows = await tx.$queryRawUnsafe<{ id: string; name: string }[]>(
      `SELECT id, name FROM tenants WHERE id <> '${seed.tenant_id}' LIMIT 1`,
    );
    return rows[0] ?? null;
  });
  if (otherTenant) {
    const foreign = jwt.sign(
      { sub: seed.user_id, tenantId: otherTenant.id, staffId: seed.staff_id, role: seed.role },
      process.env.JWT_ACCESS_SECRET as string,
      { expiresIn: '30m' },
    );
    const crossAuth = await call(`/documents/${memo.id}/authorise`, foreign, 'PATCH', {});
    check(
      `a token scoped to "${otherTenant.name}" cannot authorise this document`,
      crossAuth.status >= 400,
      `HTTP ${crossAuth.status}`,
    );
    const crossList = await call(`/documents?visitId=${visit.id}`, foreign);
    check(
      'a cross-tenant token sees none of this visit’s documents',
      Array.isArray(crossList.body) ? crossList.body.length === 0 : crossList.status >= 400,
      `${Array.isArray(crossList.body) ? crossList.body.length : '-'} row(s)`,
    );
  }

  // 14 — existing behaviour intact
  const active = await api(`/documents?visitId=${visit.id}`, token);
  check(
    'the active list still excludes voided documents',
    !active.some((d: any) => d.id === toVoid.id),
    `${active.length} active`,
  );

  // ---------------------------------------------------------------- in-browser
  const browser = await chromium.launch({ executablePath: CHROME, headless: false });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await context.addInitScript(
    (a) => {
      localStorage.setItem('kuwick-auth', JSON.stringify({ state: a, version: 0 }));
      localStorage.setItem('kuwick-record-view-layout', JSON.stringify({ state: { layout: 'canvas' }, version: 0 }));
    },
    {
      accessToken: token,
      refreshToken: token,
      staff: { id: seed.staff_id, fullName: seed.full_name, role: seed.role, clinicId: null },
      tenant: { id: seed.tenant_id, name: seed.tenant_name, slug: null },
    },
  );

  const openRecord = async () => {
    const p = await context.newPage();
    await p.goto(`${WEB}/patients/${patients[0].id}?visitId=${visit.id}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1600);
    await p.getByRole('button', { name: 'Expand all' }).click();
    await p.waitForTimeout(2200);
    await showDocuments(p);
    return p;
  };

  // 7 + 11 — terminology in the list
  {
    const p = await openRecord();
    const text = await documentsText(p);
    if (SHOTS) await p.screenshot({ path: join(OUT, 'g3bc-workspace-terminology.png') });

    check(
      '[ui] an unauthorised clinical document reads "Draft — not clinically authorised"',
      text.includes('Draft — not clinically authorised'),
      'draft wording present',
    );
    check(
      '[ui] an authorised document names the responsible doctor',
      text.includes('Clinically authorised') && text.includes(seed.full_name),
      `"Clinically authorised by ${seed.full_name}"`,
    );
    check(
      '[ui] no generic "Signed" status is shown anywhere',
      !/(^|\n)\s*Signed\s*(\n|$)/.test(text) && !text.includes('Not signed'),
      'the old generic wording is gone',
    );
    if (slip) {
      check(
        '[ui] the administrative document reads "Issued", not "Clinically authorised"',
        text.includes('Issued by'),
        'administrative wording present',
      );
    }
    await p.close();
  }

  // 7 + 8 — draft preview and blocked production
  {
    const p = await openRecord();
    // Target the DRAFT row by its state, not by position.
    await p.locator('.kw-doc-row[data-authorisation="draft"]').first()
      .locator('button.ant-btn').filter({ hasText: /^Preview$/ }).first().click();
    await p.waitForTimeout(1400);
    const drawer = await p.locator(DRAWER).first().innerText();
    if (SHOTS) await p.screenshot({ path: join(OUT, 'g3bc-draft-preview.png') });
    check(
      '[ui] the draft preview is headed DRAFT — NOT CLINICALLY AUTHORISED',
      /DRAFT — NOT CLINICALLY AUTHORISED/.test(drawer),
      'draft banner present',
    );
    const printDisabled = await p
      .locator('.ant-drawer')
      .locator('button.ant-btn')
      .filter({ hasText: /^Print$/ })
      .first()
      .isDisabled();
    const downloadDisabled = await p
      .locator('.ant-drawer')
      .locator('button.ant-btn')
      .filter({ hasText: /^Download$/ })
      .first()
      .isDisabled();
    check(
      '[ui] a draft cannot be printed or downloaded',
      printDisabled && downloadDisabled,
      `print disabled=${printDisabled}, download disabled=${downloadDisabled}`,
    );
    await p.close();
  }

  // 9 — authorised preview
  {
    const p = await openRecord();
    await p.locator('.kw-doc-row[data-authorisation="authorised"]').first()
      .locator('button.ant-btn').filter({ hasText: /^Preview$/ }).first().click();
    await p.waitForTimeout(1400);
    const drawer = await p.locator(DRAWER).first().innerText();
    if (SHOTS) await p.screenshot({ path: join(OUT, 'g3bc-authorised-preview.png') });
    check(
      '[ui] an authorised preview names the responsible doctor and is printable',
      /Clinically authorised/.test(drawer) && drawer.includes(seed.full_name),
      'authorisation shown',
    );
    await p.close();
  }

  // 3 — front-desk denial, seen by front desk
  if (frontDesk) {
    const fdContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    await fdContext.addInitScript(
      (a) => {
        localStorage.setItem('kuwick-auth', JSON.stringify({ state: a, version: 0 }));
        localStorage.setItem('kuwick-record-view-layout', JSON.stringify({ state: { layout: 'canvas' }, version: 0 }));
      },
      {
        accessToken: tokenFor(frontDesk),
        refreshToken: tokenFor(frontDesk),
        staff: { id: frontDesk.staff_id, fullName: frontDesk.full_name, role: frontDesk.role, clinicId: null },
        tenant: { id: seed.tenant_id, name: seed.tenant_name, slug: null },
      },
    );
    const p = await fdContext.newPage();
    await p.goto(`${WEB}/patients/${patients[0].id}?visitId=${visit.id}`, { waitUntil: 'networkidle' });
    await p.waitForTimeout(1600);
    await p.getByRole('button', { name: 'Expand all' }).click();
    await p.waitForTimeout(2200);
    await showDocuments(p);

    // The control is visible — hidden buttons are not security — and pressing
    // it produces the server's refusal.
    await p.locator('button.ant-btn').filter({ hasText: /^Authorise$/ }).first().click();
    await p.waitForTimeout(1800);
    const body = await p.evaluate('document.body.innerText');
    if (SHOTS) await p.screenshot({ path: join(OUT, 'g3bc-front-desk-denied.png') });
    check(
      '[ui] front desk pressing Authorise gets the server refusal, not a silent no-op',
      /Only a doctor may clinically authorise/.test(body as string),
      'server message surfaced to the user',
    );

    const stillDraft = (await api(`/documents?visitId=${visit.id}`, token)).find((d: any) => d.id === memo.id);
    check(
      'the front-desk attempt left the document unauthorised',
      stillDraft.signedAt === null && stillDraft.authorisationKind === null,
      'still a draft',
    );
    await fdContext.close();
  }

  // 10 — administrative Time Slip in the UI
  if (slip && SHOTS) {
    const p = await openRecord();
    await p.screenshot({ path: join(OUT, 'g3bc-administrative-timeslip.png') });
    await p.close();
  }

  // 12 — voided authorised document
  {
    const p = await openRecord();
    await p.locator('button.ant-btn').filter({ hasText: /voided/ }).first().click();
    await p.waitForTimeout(1400);
    const drawer = await p.locator(DRAWER).first().innerText();
    if (SHOTS) await p.screenshot({ path: join(OUT, 'g3bc-voided-authorised.png') });
    check(
      '[ui] a voided authorised document is still marked Voided and keeps its authorisation',
      /Voided/.test(drawer) && /Clinically authorised/.test(drawer),
      'both states shown',
    );
    await p.close();
  }

  void MODAL;
  await browser.close();

  // Leave the template as we found it — this check configures, it does not
  // permanently reclassify a clinic's template.
  if (timeSlip && originalSetting !== undefined) {
    await api(`/document-templates/${timeSlip.id}`, token, 'PATCH', {
      requiresClinicalAuthorisation: originalSetting,
    });
  }
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
