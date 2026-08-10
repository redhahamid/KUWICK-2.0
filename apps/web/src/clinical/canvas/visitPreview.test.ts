import { describe, expect, it } from 'vitest';
import { ClinicalNote, VisitHistoryDetail } from '../types';
import {
  DRAFT_WITHHELD,
  NO_NOTE,
  buildVisitPreview,
  previewNote,
  toPlainText,
} from './visitPreview';

// ===========================================================================
// KW2-C2 — the past-visit hover preview.
//
// A preview is a place where a doctor reads somebody else's clinical prose
// with no room for caveats and no time to check provenance. Everything here
// exists to make sure it never shows something that is not the record.
// ===========================================================================

const NOTE = (over: Partial<ClinicalNote> = {}): ClinicalNote =>
  ({
    id: 'note-1',
    visitId: 'visit-3',
    notes: '<p>Fever ×3 days. Chest clear.</p>',
    noteType: 'DOCTOR_NARRATIVE',
    entryType: 'STANDARD',
    status: 'SIGNED',
    authorNameSnapshot: 'Dr Amira Rahman',
    clinicalEntryAt: '2026-08-04T02:20:00.000Z',
    updatedAt: '2026-08-04T02:25:00.000Z',
    signedAt: '2026-08-04T02:30:00.000Z',
    ...over,
  }) as ClinicalNote;

const DETAIL = (notes: ClinicalNote[]): VisitHistoryDetail => ({ notes }) as VisitHistoryDetail;

const stamp = () => '4 Aug 2026';
const build = (notes: ClinicalNote[], max?: number) => buildVisitPreview(DETAIL(notes), stamp, max);

describe('rich text never reaches the rail as markup', () => {
  it('block tags become line breaks and every tag is removed', () => {
    expect(toPlainText('<p>One</p><p>Two</p>')).toBe('One\nTwo');
    expect(toPlainText('A<br>B')).toBe('A\nB');
    expect(toPlainText('<ul><li>x</li><li>y</li></ul>')).toBe('x\ny');
  });

  it('a script tag is text, not a script', () => {
    expect(toPlainText('<p>Hi</p><script>alert(1)</script>')).toBe('Hi\nalert(1)');
  });

  it('entities are decoded so the doctor reads words, not &amp;', () => {
    expect(toPlainText('<p>Paracetamol&nbsp;&amp;&nbsp;fluids</p>')).toBe('Paracetamol & fluids');
  });
});

describe('which note a preview shows', () => {
  it('nothing at all when the visit carries none', () => {
    expect(previewNote([])).toBeNull();
    expect(previewNote(undefined)).toBeNull();
  });

  it('the doctor narrative wins over a staff remark', () => {
    const remark = NOTE({ id: 'remark', noteType: 'STAFF_REMARK' });
    const doctor = NOTE({ id: 'doctor' });
    expect(previewNote([remark, doctor])?.id).toBe('doctor');
  });

  it('an amendment wins over the entry it corrects', () => {
    // The corrected reading is the one that stands. Showing the superseded
    // original in a preview is how a doctor acts on a fact already withdrawn.
    const original = NOTE({ id: 'original' });
    const amendment = NOTE({ id: 'amendment', entryType: 'AMENDMENT' });
    expect(previewNote([original, amendment])?.id).toBe('amendment');
  });

  it('a doctor narrative still beats an amended staff remark', () => {
    const remarkAmendment = NOTE({ id: 'remark', noteType: 'STAFF_REMARK', entryType: 'AMENDMENT' });
    const doctor = NOTE({ id: 'doctor' });
    expect(previewNote([remarkAmendment, doctor])?.id).toBe('doctor');
  });

  it('otherwise the most recent entry', () => {
    const older = NOTE({ id: 'older', clinicalEntryAt: '2026-08-04T01:00:00.000Z' });
    const newer = NOTE({ id: 'newer', clinicalEntryAt: '2026-08-04T05:00:00.000Z' });
    expect(previewNote([newer, older])?.id).toBe('newer');
  });

  it('notes are never merged into a paragraph nobody wrote', () => {
    const preview = build([NOTE({ notes: '<p>A</p>' }), NOTE({ id: 'b', notes: '<p>B</p>' })]);
    expect(preview.body).toBe('A');
    expect(preview.body).not.toContain('B');
    // Counted, so the doctor knows to open the visit rather than assuming
    // they have read everything.
    expect(preview.otherNotes).toBe(1);
  });
});

describe('a draft is never shown as the record', () => {
  it('the text is withheld and named as unfinalized', () => {
    const preview = build([NOTE({ status: 'DRAFT', notes: '<p>fever, ?viral, will rev</p>' })]);
    expect(preview.body).toBe('');
    expect(preview.withheld).toBe(DRAFT_WITHHELD);
    expect(preview.withheld).not.toMatch(/fever/i);
  });

  it('the author is still named — withheld is not anonymous', () => {
    const preview = build([NOTE({ status: 'DRAFT' })]);
    expect(preview.attribution).toBe('Dr Amira Rahman · 4 Aug 2026');
  });
});

describe('a visit with no usable note', () => {
  it('says so rather than showing an empty panel', () => {
    expect(build([]).withheld).toBe(NO_NOTE);
  });

  it('a signed note whose body is only markup counts as none', () => {
    expect(build([NOTE({ notes: '<p></p>' })]).withheld).toBe(NO_NOTE);
    expect(build([NOTE({ notes: null })]).withheld).toBe(NO_NOTE);
  });
});

describe('attribution comes from the snapshot', () => {
  it('names the author recorded at the time and the entry date', () => {
    expect(build([NOTE()]).attribution).toBe('Dr Amira Rahman · 4 Aug 2026');
  });

  it('an unattributed legacy note loses the name, never the date', () => {
    expect(build([NOTE({ authorNameSnapshot: null })]).attribution).toBe('4 Aug 2026');
  });
});

describe('clipping', () => {
  it('a short note is shown whole and not marked truncated', () => {
    const preview = build([NOTE()]);
    expect(preview.body).toBe('Fever ×3 days. Chest clear.');
    expect(preview.truncated).toBe(false);
  });

  it('a long note stops on a word boundary and says it stopped', () => {
    const long = `<p>${'symptom '.repeat(80).trim()}</p>`;
    const preview = build([NOTE({ notes: long })], 100);
    expect(preview.truncated).toBe(true);
    expect(preview.body.length).toBeLessThanOrEqual(100);
    // Never mid-word: an excerpt that ends "sympt" reads as corrupted data.
    expect(preview.body.endsWith('symptom')).toBe(true);
  });

  it('a single unbroken run is cut rather than dropped entirely', () => {
    const preview = build([NOTE({ notes: `<p>${'x'.repeat(200)}</p>` })], 50);
    expect(preview.body).toHaveLength(50);
    expect(preview.truncated).toBe(true);
  });
});
