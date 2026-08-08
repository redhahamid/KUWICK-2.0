import { join } from 'node:path';
import { config } from 'dotenv';
import { chromium } from 'playwright-core';

config({ path: join(__dirname, '..', '.env') });

/**
 * G4.5d6 — MEASURE the Clinical Canvas at 100% zoom, 1440x900.
 *
 * The owner's report is that the Canvas is not usable at 100% browser zoom —
 * it is built as though everyone runs it at 80%. This prints the numbers that
 * decide whether that is true: how much vertical space is spent above the
 * note, how many lines of the note survive on the first screen, and what
 * share of the width the note and the rail actually take.
 *
 *   npx tsx prisma/g45d6-canvas-density.ts <patientId> <visitId>
 */
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium';
const API = 'http://localhost:3000';
const WEB = 'http://localhost:5173';

const PATIENT_ID = process.argv[2];

async function main() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner.admin@smoke-test-clinic.test', password: 'DevLocal!2026' }),
  });
  const owner = (await res.json()) as Record<string, unknown>;

  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // Canvas is the layout under review; the store persists the last choice,
  // so pin it rather than depending on whatever the last session left.
  await context.addInitScript(() =>
    localStorage.setItem(
      'kuwick-record-view-layout',
      JSON.stringify({ state: { layout: 'canvas' }, version: 0 }),
    ),
  );
  await context.addInitScript(
    (a) => localStorage.setItem('kuwick-auth', JSON.stringify({ state: a, version: 0 })),
    {
      accessToken: owner.accessToken,
      refreshToken: owner.refreshToken,
      staff: owner.staff,
      tenant: owner.tenant,
    },
  );
  const page = await context.newPage();
  await page.goto(`${WEB}/patients/${PATIENT_ID}`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(2000);
  // The Canvas only mounts once a visit is selected.
  const visitRow = page.locator('.ant-list-item, .ant-table-row, [data-visit-id]').first();
  if (await visitRow.count()) await visitRow.click().catch(() => {});
  await page.waitForTimeout(2500);

  const m = await page.evaluate(() => {
    // No inner function declarations: the TypeScript runner rewrites those
    // with a `__name` helper that does not exist inside the browser.
    const boxes: Record<string, { top: number; height: number; width: number } | null> = {};
    for (const sel of [
      '.kw-app-header',
      '.kw-context-band',
      '.kw-visit-band',
      '.kw-completion-bar',
      '.kw-last-visit',
      '.kw-notes-card',
      '.kw-notes-card > .ant-card-head',
      '.kw-notes-card > .ant-card-body',
      '.kw-notes-card .ant-tabs-nav',
      '.kw-notes-card .ant-card-extra',
    ]) {
      const el = document.querySelector(sel);
      boxes[sel] = el
        ? {
            top: Math.round(el.getBoundingClientRect().top),
            height: Math.round(el.getBoundingClientRect().height),
            width: Math.round(el.getBoundingClientRect().width),
          }
        : null;
    }
    const shell = document.querySelector('.kw-canvas-shell');
    const main = document.querySelector('.kw-canvas-main');
    const rail = document.querySelector('.kw-canvas-rail');
    const editor =
      document.querySelector('.ProseMirror') ??
      document.querySelector('.kw-note-editor') ??
      document.querySelector('[contenteditable="true"]');
    const shellW = shell ? shell.getBoundingClientRect().width : 0;
    const mainW = main ? main.getBoundingClientRect().width : 0;
    const railW = rail ? rail.getBoundingClientRect().width : 0;
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      pageScrollHeight: document.documentElement.scrollHeight,
      header: boxes['.kw-app-header'],
      contextBand: boxes['.kw-context-band'],
      visitBand: boxes['.kw-visit-band'],
      completionBar: boxes['.kw-completion-bar'],
      lastVisit: boxes['.kw-last-visit'],
      notesCard: boxes['.kw-notes-card'],
      notesHead: boxes['.kw-notes-card > .ant-card-head'],
      notesBody: boxes['.kw-notes-card > .ant-card-body'],
      notesTabs: boxes['.kw-notes-card .ant-tabs-nav'],
      notesExtra: boxes['.kw-notes-card .ant-card-extra'],
      editor: editor
        ? {
            top: Math.round(editor.getBoundingClientRect().top),
            height: Math.round(editor.getBoundingClientRect().height),
          }
        : null,
      split: {
        shellW: Math.round(shellW),
        mainW: Math.round(mainW),
        railW: Math.round(railW),
        mainPct: shellW ? Math.round((mainW / shellW) * 100) : 0,
        railPct: shellW ? Math.round((railW / shellW) * 100) : 0,
      },
    };
  });

  console.log('\nG4.5d6 — CLINICAL CANVAS AT 1440x900, 100% ZOOM');
  console.log('='.repeat(70));
  console.log(JSON.stringify(m, null, 2));

  if (m.editor) {
    const belowFold = m.editor.top + m.editor.height - m.viewport.h;
    console.log(`\nNote editor starts ${m.editor.top}px down, is ${m.editor.height}px tall.`);
    console.log(
      belowFold > 0
        ? `  -> ${belowFold}px of the note is BELOW the fold on a 900px screen.`
        : `  -> the whole note fits on the first screen.`,
    );
    console.log(`  -> roughly ${Math.floor((m.viewport.h - m.editor.top) / 24)} lines visible without scrolling.`);
  }
  console.log(`\nWidth split: note ${m.split.mainPct}% / rail ${m.split.railPct}% (target 70/30).`);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
