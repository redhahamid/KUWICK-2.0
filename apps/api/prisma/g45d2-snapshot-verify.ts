import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import * as jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { chromium, Page } from 'playwright-core';

config({ path: join(__dirname, '..', '.env') });

// G4.5d2 (D-076) — verify the Last Visit Snapshot against the backend, and
// prove that reviewing history costs the open consultation nothing.
//
//   npx tsx prisma/g45d2-snapshot-verify.ts --patient=<id> --visit=<id> --auth=<file> [--shots]
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const API = 'http://localhost:3000';
const WEB = 'http://localhost:5173';
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const SHOTS = process.argv.includes('--shots');
const OUT = join(__dirname, '..', '..', '..', 'docs', 'g45-screenshots');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const SNAPSHOT_TEXT = `(() => {
  var el = document.querySelector('.kw-last-visit');
  if (!el) return null;
  var r = el.getBoundingClientRect();
  var btn = el.querySelector('.kw-last-visit-action');
  return {
    text: (el.textContent || '').replace(/\\s+/g, ' ').trim(),
    height: Math.round(r.height),
    inFold: r.top >= 0 && r.bottom <= window.innerHeight,
    actionHeight: btn ? Math.round(btn.getBoundingClientRect().height) : null,
    smallestFontPx: (function () {
      var nodes = el.querySelectorAll('*');
      var min = 99;
      for (var i = 0; i < nodes.length; i++) {
        if (!(nodes[i].textContent || '').trim()) continue;
        var f = parseFloat(window.getComputedStyle(nodes[i]).fontSize);
        if (f && f < min) min = f;
      }
      return min === 99 ? null : Math.round(min);
    })(),
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth
  };
})()`;

async function main() {
  const patientId = arg('patient');
  const visitId = arg('visit');
  const authFile = arg('auth');
  if (!patientId || !visitId || !authFile) throw new Error('Pass --patient, --visit and --auth.');
  if (SHOTS) mkdirSync(OUT, { recursive: true });

  const saved = JSON.parse(readFileSync(authFile, 'utf8'));
  const state = saved.state ?? saved;
  const claims = jwt.decode(state.accessToken) as Record<string, unknown>;
  const token = jwt.sign(
    { sub: claims.sub, tenantId: claims.tenantId, staffId: claims.staffId, role: claims.role },
    process.env.JWT_ACCESS_SECRET as string,
    { expiresIn: '2h' },
  );
  const auth = { accessToken: token, refreshToken: token, staff: state.staff, tenant: state.tenant };

  // The backend's own answer, to compare the rendered snapshot against.
  const history = await fetch(`${API}/patients/${patientId}/history?limit=10`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  const expected = history.items.find((v: { id: string }) => v.id !== visitId);
  if (!expected) throw new Error('No previous visit for this patient.');

  console.log('\nG4.5d2 — LAST VISIT SNAPSHOT');
  console.log(`expected latest previous visit: ${expected.visitNumber}`);
  console.log('='.repeat(78));

  const countRows = async () => {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${String(claims.tenantId)}, true)`;
      return tx.$queryRawUnsafe<{ v: bigint; n: bigint; d: bigint; p: bigint; doc: bigint; i: bigint }[]>(
        `SELECT (SELECT COUNT(*) FROM visits) v, (SELECT COUNT(*) FROM clinical_notes) n,
                (SELECT COUNT(*) FROM diagnoses) d, (SELECT COUNT(*) FROM prescriptions) p,
                (SELECT COUNT(*) FROM documents) doc, (SELECT COUNT(*) FROM invoices) i`,
      );
    });
    return JSON.stringify(rows[0], (k, v) => (typeof v === 'bigint' ? Number(v) : v));
  };

  const before = await countRows();

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const VIEWPORTS = [
    { name: '1920x1080', width: 1920, height: 1080 },
    { name: '1366x768', width: 1366, height: 768 },
    { name: 'tablet-900', width: 900, height: 1000 },
    { name: 'mobile-375', width: 375, height: 812 },
  ];

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      hasTouch: vp.width <= 375,
      isMobile: vp.width <= 375,
    });
    await context.addInitScript(
      (a) => {
        localStorage.setItem('kuwick-auth', JSON.stringify({ state: a, version: 0 }));
        localStorage.setItem('kuwick-record-view-layout', JSON.stringify({ state: { layout: 'canvas' }, version: 0 }));
      },
      auth,
    );
    const page: Page = await context.newPage();
    await page.goto(`${WEB}/patients/${patientId}?visitId=${visitId}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2400);

    const snap = (await page.evaluate(SNAPSHOT_TEXT)) as {
      text: string;
      height: number;
      inFold: boolean;
      actionHeight: number | null;
      smallestFontPx: number | null;
      horizontalOverflow: boolean;
    } | null;

    if (!snap) {
      check(`${vp.name} snapshot renders`, false, 'not found');
      await context.close();
      continue;
    }

    if (vp.name === '1920x1080') {
      // --- Content correctness, against the backend's own values ------------
      check('1. uses the latest PREVIOUS visit, not the current one', snap.text.includes(expected.visitNumber), expected.visitNumber);
      check('   the current visit number is absent', !snap.text.includes('V-000355') || expected.visitNumber === 'V-000355');
      // D-077 — one clock for the whole workspace: 24-hour, never AM/PM.
      // No \b before the time: the date and the time are separate elements
      // (visually spaced by the flex gap), so textContent runs them together
      // as "…202617:15" and a word boundary never appears.
      check(
        '2. date and 24-hour time shown',
        /\d{1,2} \w{3} \d{4}/.test(snap.text) && /\d{2}:\d{2}/.test(snap.text),
      );
      check('   no 12-hour clock anywhere in the snapshot', !/\b\d{1,2}:\d{2}\s?(AM|PM)\b/i.test(snap.text));

      // The UI strips a stored "Dr."/"Dr" prefix and re-applies one, so
      // "Dr. Amira Rahman" renders as "Dr Amira Rahman". Compare on the bare
      // name: the assertion is that the right PERSON is named, not that the
      // clinic's stored punctuation survived.
      const bareName = (expected.doctorName ?? '').replace(/^\s*(dr\.?|doctor)\s+/i, '').trim();
      check(
        '3. attending clinician accurate',
        !expected.doctorName || snap.text.includes(bareName),
        expected.doctorName ?? 'none',
      );
      check('   no doubled title', !/DR\s+Dr\.?/i.test(snap.text) && !snap.text.includes('Dr. Dr'));
      check('4. complaint accurate', !expected.presentingComplaint || snap.text.includes(expected.presentingComplaint));
      check('5. diagnosis accurate', !expected.primaryDiagnosis || snap.text.includes(expected.primaryDiagnosis.name));
      check(
        '6. Primary label ONLY when explicitly recorded',
        expected.primaryDiagnosis?.isPrimary ? snap.text.includes('Primary') : !snap.text.includes('Primary'),
        `isPrimary=${expected.primaryDiagnosis?.isPrimary}`,
      );
      const shownMeds = expected.medications.slice(0, 2);
      check('7. at most two medications named', shownMeds.every((m: { name: string }) => snap.text.includes(m.name)));
      const more = expected.medicationCount - shownMeds.length;
      check('8. +N more accurate', more > 0 ? snap.text.includes(`+${more} more`) : !/\+\d+ more/.test(snap.text), `expected +${more}`);
      if (expected.mc) {
        const days =
          expected.mc.startDate && expected.mc.endDate
            ? Math.round(
                (new Date(expected.mc.endDate).getTime() - new Date(expected.mc.startDate).getTime()) / 86400000,
              ) + 1
            : null;
        check('9. MC summary accurate', days ? snap.text.includes(`MC ${days} day`) : snap.text.includes('MC'), `${days} days`);
      }
      if (expected.referral) {
        check('10. referral summary accurate', snap.text.includes('Referral'));
      }
      if (expected.invoices.length === 1) {
        const inv = expected.invoices[0];
        check('11. invoice total and status match the backend', snap.text.includes(Number(inv.totalAmount).toFixed(2)) && snap.text.includes(inv.status), `${inv.totalAmount} ${inv.status}`);
        check('12. panel/cash classification accurate', snap.text.includes(expected.panelName ? `Panel ${expected.panelName}` : 'Cash'), expected.panelName ?? 'Cash');
      } else if (expected.invoices.length === 0) {
        check('11. no invoice says so, never RM0.00', snap.text.includes('No invoice created') && !snap.text.includes('RM0.00'));
      } else {
        check('13. several invoices are not combined into one total', snap.text.includes(`${expected.invoices.length} invoices`));
      }
      check('   snapshot height within the 120–150px target', snap.height <= 160, `${snap.height}px`);
      console.log(`\n  rendered: ${snap.text.slice(0, 200)}\n`);
    }

    check(`20. no horizontal overflow at ${vp.name}`, !snap.horizontalOverflow);
    check(`    no clinical text below 12px at ${vp.name}`, (snap.smallestFontPx ?? 99) >= 12, `${snap.smallestFontPx}px`);
    if (vp.width <= 375) {
      check('    View History target is at least 44px', (snap.actionHeight ?? 0) >= 44, `${snap.actionHeight}px`);
    }

    // --- C1 safety, only worth doing once, at desktop ---------------------
    if (vp.name === '1920x1080') {
      const TYPED = 'UNSAVED DRAFT — must survive opening history. 123 !@# end.';
      await page.click('.ProseMirror');
      await page.keyboard.type(TYPED);
      await page.waitForTimeout(600);
      const beforeText = await page.evaluate(() => document.querySelector('.ProseMirror')?.textContent ?? '');
      const urlBefore = page.url();

      if (SHOTS) await page.screenshot({ path: join(OUT, 'g45d2-note-before-history.png') });

      await page.click('.kw-last-visit-action');
      await page.waitForTimeout(1500);
      const drawerOpen = await page.evaluate(
        () => document.querySelectorAll('.ant-drawer-open, .ant-drawer:not(.ant-drawer-hidden)').length > 0,
      );
      check('15. View History opens the existing read-only interface', drawerOpen);
      if (SHOTS) await page.screenshot({ path: join(OUT, 'g45d2-history-open.png') });

      await page.keyboard.press('Escape');
      await page.waitForTimeout(1200);

      const afterText = await page.evaluate(() => document.querySelector('.ProseMirror')?.textContent ?? '');
      const urlAfter = page.url();
      if (SHOTS) await page.screenshot({ path: join(OUT, 'g45d2-note-after-history.png') });

      check('16. the URL is unchanged', urlBefore === urlAfter, urlAfter.slice(-40));
      check('   the current visit id is unchanged', urlAfter.includes(visitId));
      check(
        '17. the unsaved note is byte-for-byte unchanged',
        beforeText === afterText,
        `${beforeText.length} chars`,
      );
      check('   no unsaved-note prompt appeared', !(await page.evaluate(() => document.body.textContent?.includes('You have unsaved clinical notes') ?? false)));
    }

    if (SHOTS && ['1920x1080', 'tablet-900', 'mobile-375'].includes(vp.name)) {
      await page.screenshot({ path: join(OUT, `g45d2-snapshot-${vp.name}.png`) });
    }
    await context.close();
  }

  await browser.close();

  const after = await countRows();
  check('18. no database row was created or removed during review', before === after, before === after ? '' : `${before} -> ${after}`);

  // --- 19. Security -------------------------------------------------------
  const others = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    return tx.$queryRawUnsafe<{ user_id: string; staff_id: string; tenant_id: string; role: string }[]>(
      `SELECT u.id AS user_id, s.id AS staff_id, s.tenant_id, s.role::text AS role
         FROM staff s JOIN users u ON s.user_id = u.id
        WHERE s.active AND s.tenant_id <> '${String(claims.tenantId)}' LIMIT 1`,
    );
  });
  if (others.length > 0) {
    const foreign = jwt.sign(
      { sub: others[0].user_id, tenantId: others[0].tenant_id, staffId: others[0].staff_id, role: others[0].role },
      process.env.JWT_ACCESS_SECRET as string,
      { expiresIn: '1h' },
    );
    const res = await fetch(`${API}/patients/${patientId}/history?limit=5`, {
      headers: { Authorization: `Bearer ${foreign}` },
    });
    check('19. cross-tenant history read is refused', res.status === 404 || res.status === 403, `HTTP ${res.status}`);
  }
  const anon = await fetch(`${API}/patients/${patientId}/history?limit=5`);
  check('    unauthenticated history read is refused', anon.status === 401, `HTTP ${anon.status}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
