import { AllergyRecordState } from './copyRx';
import {
  allergyAlerts,
  noKnownAllergyAlerts,
  nonAllergyAlerts,
  usePatientAlerts,
} from '../hooks/usePatientAlerts';

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

/**
 * ONE PLACE TO RECORD AN ALLERGY — this reads that one place.
 *
 * There used to be two. `patient.allergies` was a free-text array the header
 * chip wrote with no author and no timestamp; ALLERGY alerts were the other,
 * attributed and append-only. The strip had to read both and de-duplicate
 * between them, and the same allergy legitimately appeared twice — staging
 * printed "NSAIDS, AUGMENTIN, PCM, NSAIDS". The array is gone; its contents
 * were carried into alerts and the column dropped.
 *
 * The de-duplication STAYS, because two clinicians can still record the same
 * allergy in slightly different words on different days, and a chip that says
 * a thing twice reads as two findings about the one thing it must be exact
 * about. Display-layer only, and the FIRST spelling wins so the earliest
 * record's words survive rather than a later re-entry's casing.
 */
export function allergyWords(labels: string[]): string[] {
  const words = labels.map((entry) => entry?.trim()).filter(Boolean) as string[];
  const seen = new Set<string>();
  return words.filter((word) => {
    const key = word.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The three states, from alerts alone.
 *
 * NONE_KNOWN needs a POSITIVE record now — an active NO_KNOWN_ALLERGY alert —
 * where it used to be inferred from an empty array. That is the same fact with
 * an author attached, and it is the one this whole change had to be careful
 * not to lose: without it, every patient who had been asked and answered none
 * would silently fall back to "Allergy not asked", and a banner that warns
 * about a question somebody already answered is a banner people stop reading.
 */
export function allergyBannerState(
  labels: string[],
  askedAndNoneKnown = false,
): AllergyRecordState {
  if (allergyWords(labels).length > 0) return 'PRESENT';
  // Allergies outrank a stale negative: asked-and-none in March does not
  // survive a reaction recorded in June, and the check above already ran.
  return askedAndNoneKnown ? 'NONE_KNOWN' : 'NONE_RECORDED';
}

/**
 * The heading on the OTHER alerts line. Deliberately not a warning word:
 * a chronic condition is context, and dressing it as an alarm is what made the
 * red chip unreadable in the first place.
 */
export const OTHER_ALERTS_PREFIX = 'Also on record:';

/** The strip's text, or null where there should be no strip at all. */
export function allergyStripText(labels: string[], askedAndNoneKnown = false): string | null {
  const state = allergyBannerState(labels, askedAndNoneKnown);
  if (state === 'NONE_KNOWN') return null;
  if (state === 'NONE_RECORDED') return ALLERGY_NOT_ASKED;
  return `${ALLERGY_STRIP_PREFIX} ${allergyWords(labels).join(', ')} ${ALLERGY_STRIP_SUFFIX}`;
}

interface AllergyStripProps {
  /** Labels of the patient's active ALLERGY alerts, verbatim. */
  allergyLabels: string[];
  /** True where an active NO_KNOWN_ALLERGY alert says the question was asked. */
  askedAndNoneKnown?: boolean;
  /** Tightens the padding where the strip sits inside a modal or a form. */
  compact?: boolean;
}

/**
 * PURE ON PURPOSE — it takes what it renders and fetches nothing.
 *
 * The first attempt had this component load the patient's alerts itself, so
 * that no call site could forget. It also meant a banner could THROW: React
 * Query needs a provider, and a strip that crashes takes the prescribing
 * screen down with it. A component whose whole job is to warn about allergies
 * is the last one that should be able to break the page it warns on.
 *
 * `PatientAllergyStrip` below does the loading. Surfaces use that.
 */
export function AllergyStrip({ allergyLabels, askedAndNoneKnown = false, compact }: AllergyStripProps) {
  const text = allergyStripText(allergyLabels, askedAndNoneKnown);
  if (!text) return null;

  return (
    <div
      className={`kw-allergy-strip${compact ? ' kw-allergy-strip-compact' : ''}`}
      // role=status, not role=alert. Assertive announcements interrupt what a
      // screen-reader user is reading, and this is a standing condition rather
      // than something that just happened.
      role="status"
      data-allergy-strip={allergyBannerState(allergyLabels, askedAndNoneKnown)}
    >
      {text}
    </div>
  );
}

/**
 * The strip, with the patient's MEDICAL alerts loaded.
 *
 * Every prescribing surface uses THIS rather than `AllergyStrip` directly, so
 * none of them can be the one that reads only `patient.allergies` and goes on
 * warning about a question that has in fact been answered. React Query dedupes
 * the key, so the four of them share one request.
 *
 * A failed or missing alerts response degrades to "Allergy not asked" rather
 * than to a blank screen — the loudest of the three states, which is the right
 * way round for a request that did not answer.
 */
export function PatientAllergyStrip({
  patientId,
  compact,
}: {
  patientId: string | undefined;
  compact?: boolean;
}) {
  const { data: alerts } = usePatientAlerts(patientId);
  // FIX 3 — the banner warns on ALLERGIES. It read every MEDICAL alert, so a
  // chronic condition arrived inside "Recorded allergies", which is a
  // do-not-prescribe list. Chronic conditions and access needs still appear —
  // on their own line below, where they say what they actually are.
  const allergyLabels = allergyAlerts(alerts).map((alert) => alert.label);
  const others = nonAllergyAlerts(alerts);

  return (
    <>
      <AllergyStrip
        allergyLabels={allergyLabels}
        askedAndNoneKnown={noKnownAllergyAlerts(alerts).length > 0}
        compact={compact}
      />
      {others.length > 0 && (
        <div
          className={`kw-other-alerts${compact ? ' kw-other-alerts-compact' : ''}`}
          role="status"
          data-other-alerts={others.length}
        >
          {OTHER_ALERTS_PREFIX} {others.map((alert) => alert.label).join(', ')}
        </div>
      )}
    </>
  );
}
