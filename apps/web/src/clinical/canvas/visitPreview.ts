import { ClinicalNote, VisitHistoryDetail } from '../types';

/**
 * Kuwick 2.0 Canvas — what a past visit shows when the doctor hovers it
 * (spec p.2, "hover any visit = note preview").
 *
 * The rail card answers "when, what did we call it, what did we give". The
 * hover answers the question that follows: "what did they actually say?" —
 * without leaving the consultation, without a click, and without opening a
 * surface the doctor then has to dismiss.
 *
 * THREE THINGS THIS MODULE REFUSES TO DO:
 *
 *  1. Show a DRAFT as though it were the record. An unsigned note is somebody
 *     mid-sentence; presenting it in a preview — where there is no room for
 *     the caveats the full history surface carries — invites a clinical
 *     decision on prose its author has not finished. Drafts are named as
 *     drafts and their text is withheld.
 *
 *  2. Merge notes. A visit can carry a doctor narrative, a staff remark and
 *     an amendment; concatenating them produces a paragraph nobody wrote and
 *     nobody signed. One note is shown, chosen by an explicit rule, and the
 *     rest are COUNTED so the doctor knows to open the visit.
 *
 *  3. Render HTML. The preview is plain text, so a stored note can never put
 *     markup — or anything else — into the rail.
 */

/**
 * Hover intent, in milliseconds.
 *
 * A pointer crossing the rail on its way to the note passes over four cards.
 * Firing on contact would issue four requests and flash four panels for a
 * gesture that meant none of them. 300ms is long enough to separate "moving
 * across" from "looking at", and short enough that a deliberate hover does not
 * feel like waiting.
 */
export const HOVER_INTENT_MS = 300;

/** How much of the note the panel shows before it stops. */
export const PREVIEW_MAX_CHARS = 320;

export const DRAFT_WITHHELD = 'Note not finalized for this visit.';
export const NO_NOTE = 'No clinical note recorded for this visit.';

/** Rich text in, plain text out. Shared shape with the note tab's stripper. */
export function toPlainText(html: string): string {
  return html
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The ONE note a preview shows.
 *
 * The doctor's narrative is the clinical record of the visit; a staff remark
 * is context around it. Preferring the narrative means the hover answers the
 * question actually being asked, and an amendment — the corrected reading —
 * wins over the original it corrects, because that is the version that stands.
 *
 * Ties break on `clinicalEntryAt`, the time the entry describes, falling back
 * to when the row was written.
 */
export function previewNote(notes: ClinicalNote[] | undefined): ClinicalNote | null {
  const all = notes ?? [];
  if (all.length === 0) return null;
  const rank = (note: ClinicalNote) =>
    (note.noteType === 'DOCTOR_NARRATIVE' ? 2 : 0) + (note.entryType === 'AMENDMENT' ? 1 : 0);
  const when = (note: ClinicalNote) => Date.parse(note.clinicalEntryAt ?? note.updatedAt ?? '') || 0;
  return [...all].sort((a, b) => rank(b) - rank(a) || when(b) - when(a))[0];
}

export interface VisitPreview {
  /** The note text, already plain and already clipped. Empty when withheld. */
  body: string;
  /** True when `body` stops short of the note's end. */
  truncated: boolean;
  /** Why there is no body, or null when there is one. */
  withheld: string | null;
  /** "Dr Amira Rahman · 4 Aug 2026" — from the SNAPSHOT, never a live name. */
  attribution: string | null;
  /** Other notes on this visit that this preview is not showing. */
  otherNotes: number;
}

/**
 * The whole preview, from the detail the history endpoint already returns.
 *
 * `formatDate` is injected so this module owns the words and the clinic's
 * timezone rules stay in one place (clinicTime).
 */
export function buildVisitPreview(
  detail: VisitHistoryDetail | undefined,
  formatDate: (iso: string) => string,
  maxChars = PREVIEW_MAX_CHARS,
): VisitPreview {
  const notes = detail?.notes ?? [];
  const note = previewNote(notes);
  const otherNotes = Math.max(0, notes.length - (note ? 1 : 0));

  if (!note) {
    return { body: '', truncated: false, withheld: NO_NOTE, attribution: null, otherNotes: 0 };
  }

  // The snapshot, not the *Ref: it is the historical truth and survives a
  // later rename or a change of designation (C0).
  const stamp = note.clinicalEntryAt ?? note.signedAt ?? note.updatedAt;
  const attribution = [note.authorNameSnapshot, stamp ? formatDate(stamp) : null]
    .filter(Boolean)
    .join(' · ');

  if (note.status !== 'SIGNED') {
    return {
      body: '',
      truncated: false,
      withheld: DRAFT_WITHHELD,
      attribution: attribution || null,
      otherNotes,
    };
  }

  const text = toPlainText(note.notes ?? '');
  if (!text) {
    return { body: '', truncated: false, withheld: NO_NOTE, attribution: attribution || null, otherNotes };
  }

  // Clipped on a word boundary where one is near the limit — a preview that
  // ends mid-word reads as corrupted data rather than as an excerpt.
  if (text.length <= maxChars) {
    return { body: text, truncated: false, withheld: null, attribution: attribution || null, otherNotes };
  }
  const cut = text.slice(0, maxChars);
  const space = cut.lastIndexOf(' ');
  return {
    body: (space > maxChars - 40 ? cut.slice(0, space) : cut).trimEnd(),
    truncated: true,
    withheld: null,
    attribution: attribution || null,
    otherNotes,
  };
}
