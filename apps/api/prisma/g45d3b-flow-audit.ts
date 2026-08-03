import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import * as jwt from 'jsonwebtoken';
import { chromium, Page } from 'playwright-core';

config({ path: join(__dirname, '..', '.env') });

// G4.5d3b PART A — audit the EXISTING Flow view against the shared-workspace
// contract, before deciding whether it can be exposed as a clinic default.
//
//   npx tsx prisma/g45d3b-flow-audit.ts --patient=<id> --visit=<id> --auth=<file>
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const WEB = 'http://localhost:5173';
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

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

/** The layout switch lives in the context band (Canvas) or its own row (Flow). */
async function switchTo(page: Page, label: 'Canvas' | 'Flow') {
  await page.click(`.ant-segmented-item:has-text("${label}")`);
  await page.waitForTimeout(1400);
}

const NOTE_TEXT = () => (document.querySelector('.ProseMirror')?.textContent ?? '');

async function main() {
  const patientId = arg('patient');
  const visitId = arg('visit');
  const authFile = arg('auth');
  if (!patientId || !visitId || !authFile) throw new Error('Pass --patient, --visit and --auth.');

  const saved = JSON.parse(readFileSync(authFile, 'utf8'));
  const state = saved.state ?? saved;
  const claims = jwt.decode(state.accessToken) as Record<string, unknown>;
  const token = jwt.sign(
    { sub: claims.sub, tenantId: claims.tenantId, staffId: claims.staffId, role: claims.role },
    process.env.JWT_ACCESS_SECRET as string,
    { expiresIn: '2h' },
  );
  const auth = { accessToken: token, refreshToken: token, staff: state.staff, tenant: state.tenant };

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await context.addInitScript(
    (a) => {
      localStorage.setItem('kuwick-auth', JSON.stringify({ state: a, version: 0 }));
      localStorage.setItem('kuwick-record-view-layout', JSON.stringify({ state: { layout: 'canvas' }, version: 0 }));
    },
    auth,
  );
  const page = await context.newPage();

  // Count the network calls a switch causes — a presentation change should not
  // be a data event.
  const clinicalCalls: string[] = [];
  page.on('request', (req) => {
    const url = req.url();
    if (!url.includes('/api') && !url.includes(':3000')) return;
    if (req.method() !== 'GET') clinicalCalls.push(`${req.method()} ${url.replace(/^.*:3000/, '')}`);
  });

  await page.goto(`${WEB}/patients/${patientId}?visitId=${visitId}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2400);

  console.log('\nG4.5d3b PART A — EXISTING FLOW VIEW AUDIT');
  console.log('='.repeat(78));

  // --- What Flow actually renders ---------------------------------------
  await switchTo(page, 'Flow');
  const flowShape = await page.evaluate(`(() => ({
    hasCanvasShell: !!document.querySelector('.kw-canvas-shell'),
    hasRail: !!document.querySelector('.kw-clinical-rail'),
    hasCompletionBar: !!document.querySelector('.kw-completion-bar'),
    hasSnapshot: !!document.querySelector('.kw-last-visit'),
    hasContextBand: !!document.querySelector('.kw-context-band'),
    hasEditor: !!document.querySelector('.ProseMirror'),
    collapsedSections: document.querySelectorAll('.ant-collapse-header').length,
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth
  }))()`);
  console.log(`\n  Flow renders: ${JSON.stringify(flowShape)}\n`);

  check('Flow has a clinical note editor', (flowShape as any).hasEditor);
  check('Flow does NOT show the Canvas rail', !(flowShape as any).hasRail);
  check('Flow has NO collapsed reveal-only sections', (flowShape as any).collapsedSections === 0);
  check('Flow has no horizontal overflow at 1920', !(flowShape as any).horizontalOverflow);
  check(
    'Flow currently LACKS the Last Visit Snapshot',
    !(flowShape as any).hasSnapshot,
    'reported, not asserted as correct',
  );
  check(
    'Flow currently LACKS the Visit Completion bar',
    !(flowShape as any).hasCompletionBar,
    'reported, not asserted as correct',
  );

  // --- The contract: an unsaved note must survive a switch ---------------
  await switchTo(page, 'Canvas');
  const TYPED = 'C1 SWITCH PROBE — this text must survive Canvas/Flow. 123 !@#';
  await page.click('.ProseMirror');
  await page.keyboard.type(TYPED);
  await page.waitForTimeout(700);

  const beforeText = await page.evaluate(NOTE_TEXT);
  const urlBefore = page.url();
  clinicalCalls.length = 0;

  await switchTo(page, 'Flow');
  const inFlow = await page.evaluate(NOTE_TEXT);
  await switchTo(page, 'Canvas');
  const backInCanvas = await page.evaluate(NOTE_TEXT);

  console.log('');
  check('the URL is unchanged by switching', urlBefore === page.url());
  check('the visit id is unchanged', page.url().includes(visitId));
  check(
    'the unsaved note survives Canvas -> Flow',
    inFlow === beforeText,
    `${beforeText.length} chars -> ${inFlow.length} chars`,
  );
  check(
    'the unsaved note survives Flow -> Canvas',
    backInCanvas === beforeText,
    `${beforeText.length} chars -> ${backInCanvas.length} chars`,
  );
  check(
    'switching triggers NO write request',
    clinicalCalls.length === 0,
    clinicalCalls.slice(0, 4).join(' | ') || 'none',
  );
  check(
    'no unsaved-note prompt appeared',
    !(await page.evaluate(`document.body.textContent.includes('You have unsaved clinical notes')`)),
  );

  // --- Responsiveness of the existing Flow -------------------------------
  for (const [w, h] of [
    [900, 1000],
    [375, 812],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(900);
    const overflow = await page.evaluate(
      `document.documentElement.scrollWidth > window.innerWidth`,
    );
    check(`Flow has no horizontal overflow at ${w}px`, !overflow);
  }

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
