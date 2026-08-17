import { describe, expect, it } from 'vitest';
import { editorSurfaceClass } from './RichTextEditor';
// Vite `?raw` imports: the source text of the composition and the stylesheet,
// with no node builtins leaking into the browser tsconfig.
import pageSource from './PatientDashboardPage.tsx?raw';
import editorSource from './RichTextEditor.tsx?raw';
import secondarySource from './sections/SecondarySections.tsx?raw';
import documentsSectionSource from './sections/DocumentsSection.tsx?raw';
import invoiceSectionSource from './sections/InvoiceSection.tsx?raw';
import barSource from './invoice/InvoiceBottomBar.tsx?raw';
// Vitest's CSS pipeline swallows `?raw` on stylesheets, so the one non-TS
// asset is read straight from disk. Test-only; the app tsconfig has no node
// types, hence the local suppression.
// @ts-expect-error — node builtin without @types/node in the browser tsconfig
import { readFileSync } from 'node:fs';

const cssSource: string = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

// ===========================================================================
// G4.5d3c-3a0v (D-090) — FOOTER REACHABILITY AND CANVAS DUPLICATION CLOSURE
//
// Two kinds of assertion here. The height rules and the class selection are
// ordinary unit tests. The COMPOSITION facts — that the active Canvas no
// longer renders the duplicate bottom Documents/Invoice sections, and that
// the shared components survive for the surfaces that still use them — are
// pinned against the source itself, because they are facts about what a page
// renders, and a regression would otherwise only be visible in a browser.
// ===========================================================================

describe('duplicate bottom sections are gone from the active Canvas', () => {
  const page = pageSource;

  it('4/5. the Canvas composition no longer renders SecondarySections', () => {
    expect(page).not.toContain('<SecondarySections');
    expect(page).not.toContain("from './sections/SecondarySections'");
  });

  /**
   * b4 PIECE B moved this, and the assertion moved with it DELIBERATELY.
   *
   * What it guarded is that the Canvas ends in exactly ONE completion
   * surface, reachable, and that nothing quietly removed it. That is still
   * what is asserted — the surface is now the sticky bottom bar, which
   * CARRIES the completion action rather than sitting beside it
   * (`ConsultationFooter variant="bar"` inside `InvoiceBottomBar`).
   *
   * The page must therefore mount the bar and must NOT mount a second,
   * panel-variant footer of its own: two completion actions on one page is
   * precisely the duplication this whole describe block exists to prevent.
   */
  it('the sticky bottom bar is the final active-Canvas workflow element', () => {
    expect(page).toContain('<InvoiceBottomBar');
    expect(page).not.toContain('<ConsultationFooter');
  });

  it('the bar carries the completion action rather than duplicating it', () => {
    expect(barSource).toContain('<ConsultationFooter');
    expect(barSource).toContain('variant="bar"');
    // One instance, one set of completion rules.
    expect(barSource.match(/<ConsultationFooter/g)).toHaveLength(1);
  });

  it('the top Visit Actions surface is untouched', () => {
    expect(page).toContain('<VisitCompletionBar');
  });

  it('the full surfaces are reachable as drawers, same components as Flow', () => {
    // One implementation per surface: the drawers mount DocumentsTab and
    // InvoiceSummary, exactly what the Flow layout's tabs mount.
    expect(page).toMatch(/Drawer[\s\S]*title="Documents"[\s\S]*<DocumentsTab/);
    expect(page).toMatch(/Drawer[\s\S]*title="Invoice"[\s\S]*<InvoiceSummary/);
  });

  it('6. the shared section components still exist for other surfaces', () => {
    // Removed from the Canvas COMPOSITION only. The components themselves
    // stay, so nothing that still renders them (or is restored later) breaks.
    expect(secondarySource).toContain('export function SecondarySections');
    expect(documentsSectionSource).toContain('export function DocumentsSection');
    expect(invoiceSectionSource).toContain('export function InvoiceSection');
    // Flow's tabs still mount the shared implementations.
    expect(page).toMatch(/activeTab\.key === 'documents'[\s\S]{0,200}<DocumentsTab/);
    expect(page).toMatch(/activeTab\.key === 'invoices'[\s\S]{0,200}<InvoiceSummary/);
  });
});

describe('clinical note height rules', () => {
  const css = cssSource;
  const block = (selector: string) => {
    const start = css.indexOf(selector);
    expect(start, `${selector} must exist`).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf('}', start));
  };

  it('7. the editable Canvas note keeps a practical minimum height', () => {
    const fill = block('.kw-editor-fill .ProseMirror');
    const min = Number(/min-height:\s*(\d+)px/.exec(fill)?.[1]);
    expect(min).toBeGreaterThanOrEqual(380);
    expect(min).toBeLessThanOrEqual(440);
  });

  // G4.5d3c-3c — this rule is the REVERSE of D-090's, deliberately and with
  // owner approval. D-090 removed the ceiling so a short note stopped
  // reserving blank space; the consequence was that a LONG note grew without
  // limit and pushed the diagnoses, medications and the Consultation Footer
  // steadily off the screen. Both floor and ceiling now, with the doctor's
  // own text scrolling inside the editor rather than moving the page.
  it('9. the editable note is BOUNDED and scrolls internally past its ceiling', () => {
    const fill = block('.kw-editor-fill .ProseMirror');
    expect(fill).not.toMatch(/[^-]height:/); // still no FIXED height
    expect(fill).toContain('max-height');
    expect(fill).toContain('overflow-y: auto');
  });

  it("9b. the desktop ceiling sits inside the approved 420–520px band", () => {
    const fill = block('.kw-editor-fill .ProseMirror');
    const cap = Number(/max-height:\s*min\([^,]+,\s*(\d+)px\)/.exec(fill)?.[1]);
    expect(cap).toBeGreaterThanOrEqual(420);
    expect(cap).toBeLessThanOrEqual(520);
  });

  it('8. a signed note is sized by content with a modest floor, and is bounded too', () => {
    const signed = block('.kw-editor-signed .ProseMirror');
    const min = Number(/min-height:\s*(\d+)px/.exec(signed)?.[1]);
    expect(min).toBeGreaterThanOrEqual(240);
    expect(min).toBeLessThanOrEqual(300);
    expect(signed).not.toMatch(/[^-]height:/);
    // A long SIGNED note buries the footer exactly as a long draft does.
    expect(signed).toContain('max-height');
    expect(signed).toContain('overflow-y: auto');
  });

  it('17. tablet/mobile/Flow keeps its usable floor', () => {
    const minBlock = block('.kw-editor-min .ProseMirror');
    expect(minBlock).toContain('min-height: 300px');
  });

  it('9c. tablet and phone get SMALLER ceilings than desktop', () => {
    // On one column the editor competes with every other section for the
    // whole viewport, so the desktop band would swallow the record.
    const desktopCap = Number(
      /max-height:\s*min\([^,]+,\s*(\d+)px\)/.exec(block('.kw-editor-fill .ProseMirror'))?.[1],
    );
    const caps = [...css.matchAll(/max-height:\s*min\([^,]+,\s*(\d+)px\)/g)].map((m) => Number(m[1]));
    const responsive = caps.filter((cap) => cap < desktopCap);
    expect(responsive.length).toBeGreaterThanOrEqual(2);
  });

  it('mobile font-size covers the signed surface too', () => {
    // 16px inputs prevent iOS zoom-on-focus; the new class must be in the
    // same mobile rule as the other two editor surfaces.
    expect(css).toMatch(/\.kw-editor-signed \.ProseMirror,[\s\S]{0,400}font-size: 16px/);
  });
});

describe('editor surface class selection', () => {
  it('an editable Canvas note gets the full typing surface', () => {
    expect(editorSurfaceClass(true, true)).toBe('kw-editor-fill');
  });

  it('12. a signed/read-only Canvas note gets the content-sized surface', () => {
    expect(editorSurfaceClass(true, false)).toBe('kw-editor-signed');
  });

  it('Flow and mobile keep their existing surface regardless of editability', () => {
    expect(editorSurfaceClass(false, true)).toBe('kw-editor-min');
    expect(editorSurfaceClass(false, false)).toBe('kw-editor-min');
    expect(editorSurfaceClass(undefined, true)).toBe('kw-editor-min');
  });

  it('10. the choice is a class string, never a different component tree', () => {
    // Both values are classes on the SAME EditorContent node: flipping
    // editability restyles the surface without remounting TipTap, which is
    // what C1's in-memory draft depends on.
    expect(editorSource).toContain("editorSurfaceClass(fill, editable)");
    const occurrences = editorSource.match(/<EditorContent/g) ?? [];
    expect(occurrences).toHaveLength(1);
  });
});
