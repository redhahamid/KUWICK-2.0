import { join } from 'node:path';
import { chromium, Page } from 'playwright-core';

// G4.5-STAGING — UAT verification against a DEPLOYED stack (API + static web),
// not a dev server. Read-only: drives the app exactly as the owner would.
//
//   npx tsx prisma/_staging-verify.ts <webBaseUrl> <apiBaseUrl> <password>
const WEB = process.argv[2];
const API = process.argv[3];
const PASSWORD = process.argv[4];
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium';

const DOMAIN = 'uat.kuwick.invalid';
const ACCOUNTS = {
  owner: `owner@${DOMAIN}`,
  frontdesk: `frontdesk@${DOMAIN}`,
  finance: `finance@${DOMAIN}`,
  doctor: `doctor@${DOMAIN}`,
  stock: `stock@${DOMAIN}`,
};

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = '') {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

async function login(email: string) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

async function main() {
  console.log(`\nG4.5-STAGING UAT verification`);
  console.log(`  web: ${WEB}`);
  console.log(`  api: ${API}`);
  console.log('='.repeat(72));

  // --- 1. Every synthetic role can authenticate -------------------------
  const sessions: Record<string, Record<string, unknown>> = {};
  for (const [key, email] of Object.entries(ACCOUNTS)) {
    const r = await login(email);
    check(`login: ${key}`, r.status === 200 || r.status === 201, `HTTP ${r.status}`);
    if (r.body.accessToken) sessions[key] = r.body;
  }

  // --- 2. A wrong password is refused -----------------------------------
  {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ACCOUNTS.owner, password: 'not-the-password' }),
    });
    check('authentication is genuinely enforced', res.status === 401, `HTTP ${res.status}`);
  }

  // --- 3. Unauthenticated API access is refused -------------------------
  {
    const res = await fetch(`${API}/patients`);
    check('unauthenticated API read is refused', res.status === 401, `HTTP ${res.status}`);
  }

  const token = sessions.frontdesk?.accessToken as string;
  const doctorToken = sessions.doctor?.accessToken as string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  // --- 4. The seeded UAT scenarios are present --------------------------
  const clinics = (await (await fetch(`${API}/clinics`, { headers: auth(token) })).json()) as Array<{ id: string; name: string }>;
  check('clinic exists', clinics.length > 0, clinics[0]?.name);
  const clinicId = clinics[0]?.id;

  const board = (await (
    await fetch(`${API}/queue-tickets/board?clinicId=${clinicId}`, { headers: auth(token) })
  ).json()) as { rows: Array<Record<string, any>>; counts: Record<string, number> };
  check('queue board answers', Array.isArray(board.rows), `${board.rows?.length} rows`);
  check(
    'queue covers dispensary and payment stages',
    board.rows.some((r) => r.stage === 'DISPENSARY') && board.rows.some((r) => r.stage === 'PAYMENT'),
    `stages: ${[...new Set(board.rows.map((r) => r.stage))].join(', ')}`,
  );
  check(
    'Documentation Pending scenario is visible as a blocker',
    board.rows.some((r) => (r.blockers ?? []).some((b: any) => b.code === 'CLINICAL_DOCUMENTATION_PENDING')),
  );
  check(
    'an eligible Complete Visit exists',
    board.rows.some((r) => r.canComplete === true),
  );
  check(
    'a panel visit with zero patient responsibility exists',
    board.rows.some((r) => r.panelName && Number(r.billing?.patientResponsibility ?? -1) === 0),
  );

  // --- 5. Dispensary board and stock states -----------------------------
  const disp = (await (
    await fetch(`${API}/dispensary/board?clinicId=${clinicId}`, { headers: auth(token) })
  ).json()) as { rows: Array<Record<string, any>> };
  check('dispensary board answers', Array.isArray(disp.rows), `${disp.rows?.length} patients`);
  const states = disp.rows.flatMap((r) => r.medications.map((m: any) => m.stock.state));
  check('adequate stock present', states.includes('IN_STOCK'));
  check('insufficient stock present', states.includes('INSUFFICIENT'));
  check('out-of-stock present', states.includes('OUT_OF_STOCK'), `states: ${[...new Set(states)].join(', ')}`);

  // --- 6. Label preview comes from the record ---------------------------
  const withMeds = disp.rows.find((r) => r.medications.some((m: any) => m.status === 'ORDERED'));
  const rx = withMeds?.medications.find((m: any) => m.status === 'ORDERED');
  if (rx) {
    const res = await fetch(`${API}/dispensary/prescriptions/${rx.prescriptionId}/label-preview`, {
      headers: auth(token),
    });
    const label = (await res.json()) as Record<string, any>;
    check('label preview renders from the record', res.status === 200 && Boolean(label?.medication?.name), label?.medication?.name);
  } else {
    check('label preview renders from the record', false, 'no ORDERED prescription found');
  }

  // --- 7. RBAC still enforced on the deployed API -----------------------
  {
    const financeToken = sessions.finance?.accessToken as string;
    const res = await fetch(`${API}/dispensary/board?clinicId=${clinicId}`, { headers: auth(financeToken) });
    check('finance is refused the dispensary (RBAC preserved)', res.status === 403, `HTTP ${res.status}`);
  }

  // --- 8. Attachment validation preserved -------------------------------
  {
    const visitId = board.rows[0]?.visitId;
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array([0x4d, 0x5a, 0x90, 0x00])], { type: 'application/pdf' }), 'fake.pdf');
    const res = await fetch(`${API}/visits/${visitId}/attachments`, {
      method: 'POST',
      headers: auth(doctorToken),
      body: form,
    });
    check('attachment magic-byte validation preserved', res.status >= 400, `HTTP ${res.status}`);
  }

  // --- 9. Browser: the UAT routes actually render -----------------------
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const openAs = async (session: Record<string, unknown>, viewport: { width: number; height: number }) => {
    const context = await browser.newContext({ viewport });
    await context.addInitScript(
      (a) => {
        localStorage.setItem('kuwick-auth', JSON.stringify({ state: a, version: 0 }));
        // The stored record-view default is 'flow'; the Canvas is what the
        // Add Medication modal lives on, so select it explicitly.
        localStorage.setItem(
          'kuwick-record-view-layout',
          JSON.stringify({ state: { layout: 'canvas' }, version: 0 }),
        );
      },
      {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        staff: session.staff,
        tenant: session.tenant,
      },
    );
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    return { page, context };
  };

  const routeChecks: Array<[string, string, Record<string, unknown>, RegExp]> = [
    ['Queue', '/queue', sessions.frontdesk, /Queue Management/i],
    ['Dispensary', '/dispensary', sessions.frontdesk, /Dispensary/i],
    ['Patients', '/patients', sessions.frontdesk, /Patient/i],
    ['Appointments', '/appointments', sessions.frontdesk, /Appointment/i],
    ['Tasks', '/procedure-queue', sessions.frontdesk, /Task|Procedure/i],
  ];
  for (const [label, route, session, expect] of routeChecks) {
    const { page, context } = await openAs(session, { width: 1440, height: 900 });
    await page.goto(`${WEB}${route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const text = await page.evaluate(() => document.body.innerText);
    const errors = await page.evaluate(() => document.body.innerText.includes('Failed to fetch'));
    check(`route renders: ${label}`, expect.test(text) && !errors, `${text.slice(0, 40).replace(/\n/g, ' ')}…`);
    await context.close();
  }

  // --- 10. Doctor Canvas on a real seeded visit -------------------------
  {
    const consult = board.rows.find((r) => r.stage === 'CONSULTATION') ?? board.rows[0];
    const { page, context } = await openAs(sessions.doctor, { width: 1440, height: 900 });
    await page.goto(`${WEB}/patients/${consult.patientId}?visitId=${consult.visitId}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(4000);
    const found = await page.evaluate(() => {
      const t = document.body.innerText;
      return {
        diagnosis: /Diagnos/i.test(t),
        medications: /Medication/i.test(t),
        vitals: /BP|Temp|Weight/i.test(t),
        addMedication: [...document.querySelectorAll('button')].some((b) => /Add Medication/i.test(b.textContent ?? '')),
      };
    });
    check('Doctor Canvas renders diagnosis, medications and vitals', found.diagnosis && found.medications && found.vitals, JSON.stringify(found));
    check('Add Medication is reachable', found.addMedication);
    await context.close();
  }

  // --- 11. Mobile route availability ------------------------------------
  {
    const { page, context } = await openAs(sessions.frontdesk, { width: 390, height: 844 });
    await page.goto(`${WEB}/dispensary`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    const mobile = await page.evaluate(() => ({
      rendered: /Dispensary/i.test(document.body.innerText),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }));
    check('mobile dispensary renders without horizontal overflow', mobile.rendered && !mobile.horizontalOverflow, JSON.stringify(mobile));
    await context.close();
  }

  await browser.close();
  console.log('='.repeat(72));
  console.log(`${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
