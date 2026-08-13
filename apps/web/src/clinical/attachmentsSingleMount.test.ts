import { describe, expect, it } from 'vitest';
// Node environment (the suite default), so `import.meta.url` is a real file
// URL and the tree can be walked. Same suppression as
// canvasReachability.test.ts: the app tsconfig deliberately has no node types.
// @ts-expect-error — node builtin without @types/node in the browser tsconfig
import { readFileSync, readdirSync, statSync } from 'node:fs';

// ===========================================================================
// b0 — ONE ATTACHMENTS COMPONENT, MOUNTED ONCE.
//
// The reported defect ("Attachments (N)" twice, the thumbnail twice, Upload
// over the note area) was not a bug inside either component. It was TWO
// components rendering the same list, mounted one above the other by
// PatientDashboardPage. Every unit test of each component passed throughout,
// and would have kept passing.
//
// This is the assertion that would have caught it: not what a render looks
// like, but how many places in the app put an attachments surface on screen.
// It is a fact about the source, so it is checked against the source —
// following canvasReachability.test.ts, which pins the Canvas's composition
// the same way and for the same reason.
// ===========================================================================

const WEB_SRC = new URL('../', import.meta.url).pathname.replace(/\/$/, '');

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir) as string[]) {
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) sources(full, found);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(full);
  }
  return found;
}

const relative = (file: string) => file.replace(`${WEB_SRC}/`, '');

describe('the visit attachments surface exists in exactly one place', () => {
  it('sanity: the sweep can see the source tree', () => {
    // Without this, a path that resolved to nothing would make every
    // assertion below vacuously true — which is precisely the failure mode
    // this file exists to prevent elsewhere.
    const files = sources(WEB_SRC).map(relative);
    expect(files).toContain('clinical/ClinicalNotesTab.tsx');
    expect(files).toContain('clinical/PatientDashboardPage.tsx');
    expect(files.length).toBeGreaterThan(50);
  });

  it('is mounted in exactly one place in the app', () => {
    const mounts = sources(WEB_SRC)
      .filter((file) => /<VisitAttachments[\s/>]/.test(readFileSync(file, 'utf8')))
      .map(relative);
    expect(mounts).toEqual(['clinical/ClinicalNotesTab.tsx']);
  });

  it('the two components it replaced are gone, not merely unmounted', () => {
    // Left in the tree they would be picked up by the next person adding an
    // attachments surface, and the duplication would return with them. The
    // pattern matches an IMPORT or a MOUNT, not the names in prose — the
    // replacement's own comment explains what it replaced, and should.
    const remaining = sources(WEB_SRC)
      .filter((file) => /(<|from '\.[^']*\/)(ClinicalImageStrip|VisitAttachmentsPanel)/.test(readFileSync(file, 'utf8')))
      .map(relative);
    expect(remaining).toEqual([]);
  });

  it('the Canvas page no longer owns any attachments state', () => {
    // The strip's expand/collapse flag lived on the page, which is how one
        // component's Upload button ended up revealing another component.
    const page = readFileSync(`${WEB_SRC}/clinical/PatientDashboardPage.tsx`, 'utf8');
    expect(page).not.toMatch(/attachmentsExpanded/);
  });
});
