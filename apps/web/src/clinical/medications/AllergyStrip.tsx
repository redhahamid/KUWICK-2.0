import { AllergyRecordState, allergyRecordState } from './copyRx';

/**
 * KW2-C2 — the PERSISTENT allergy strip.
 *
 * The rejected alternative was a popup on every add. Alert fatigue is not a
 * theory: a dialog that appears for every medication on every patient gets
 * dismissed by muscle memory within a week, and then it is worse than nothing
 * because everyone believes it is still being read.
 *
 * So it is a strip, and it obeys four rules:
 *
 *   1. PERSISTENT. It is pinned wherever prescribing happens and stays there.
 *      Nothing is ever gated behind acknowledging it.
 *   2. NON-DISMISSABLE. No close button — there is nothing to dismiss, because
 *      it is not an event. It is a standing fact about the patient.
 *   3. AMBER, NEVER RED. Red means stop. Nothing here has decided that
 *      anything is wrong; the strip says "this patient has allergies on
 *      record, and only you can decide whether this medicine is one of them".
 *   4. VERBATIM. The patient's own recorded words, unparaphrased and
 *      untruncated. A summarised allergy is a changed allergy.
 *
 * THREE STATES, and the middle one renders NOTHING on purpose:
 *
 *   PRESENT       — allergies on record. The strip, with the words.
 *   NONE_RECORDED — nobody ever asked. Its own strip: absence of data is a
 *                   warning in its own right, and an empty field on a new
 *                   patient is a question nobody put, not a negative answer.
 *   NONE_KNOWN    — asked, and none known. NO STRIP. This is the whole reason
 *                   the three states are kept apart: papering a confirmed
 *                   negative with a warning is how the other two stop being
 *                   read.
 */

export const ALLERGY_STRIP_PREFIX = '⚠ ALLERGIES:';
export const ALLERGY_STRIP_SUFFIX = '— check before prescribing';
export const ALLERGY_NOT_ASKED = '⚠ Allergy not asked';

/** The strip's text, or null where there should be no strip at all. */
export function allergyStripText(allergies: string[] | null | undefined): string | null {
  const state: AllergyRecordState = allergyRecordState(allergies);
  if (state === 'NONE_KNOWN') return null;
  if (state === 'NONE_RECORDED') return ALLERGY_NOT_ASKED;
  const words = (allergies ?? []).map((entry) => entry?.trim()).filter(Boolean).join(', ');
  return `${ALLERGY_STRIP_PREFIX} ${words} ${ALLERGY_STRIP_SUFFIX}`;
}

interface AllergyStripProps {
  allergies: string[] | null | undefined;
  /** Tightens the padding where the strip sits inside a modal or a form. */
  compact?: boolean;
}

export function AllergyStrip({ allergies, compact }: AllergyStripProps) {
  const text = allergyStripText(allergies);
  if (!text) return null;

  return (
    <div
      className={`kw-allergy-strip${compact ? ' kw-allergy-strip-compact' : ''}`}
      // role=status, not role=alert. Assertive announcements interrupt what a
      // screen-reader user is reading, and this is a standing condition rather
      // than something that just happened.
      role="status"
      data-allergy-strip={allergyRecordState(allergies)}
    >
      {text}
    </div>
  );
}
