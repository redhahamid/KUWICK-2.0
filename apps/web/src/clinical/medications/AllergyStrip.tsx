import { AllergyRecordState, allergyRecordState } from './copyRx';
import { allergyAlerts, nonAllergyAlerts, usePatientAlerts } from '../hooks/usePatientAlerts';

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
 * b1.5 PHASE D — the strip reads BOTH places an allergy can be recorded.
 *
 * `patient.allergies` is the quick-record field on the header chip. MEDICAL
 * patient alerts are the other, and they are how a chronic standing fact gets
 * onto the record with an author and a timestamp. Until now the strip looked
 * only at the first, so a doctor who recorded "Penicillin allergy" as a
 * MEDICAL alert still saw "Allergy not asked" on every prescribing surface —
 * the banner permanently warning about a question that had in fact been
 * answered, which is precisely how a warning stops being read.
 *
 * The patient's own words are never paraphrased, so the alert LABELS join the
 * list verbatim alongside the quick-record entries.
 */
export function allergyWords(
  allergies: string[] | null | undefined,
  medicalAlertLabels: string[] = [],
): string[] {
  const words = [...(allergies ?? []), ...medicalAlertLabels]
    .map((entry) => entry?.trim())
    .filter(Boolean) as string[];

  // DEDUPLICATED, case- and whitespace-insensitively.
  //
  // The same allergy legitimately lives in BOTH stores: `patient.allergies` is
  // the header's quick-record field, and the same drug may since have been
  // recorded as an ALLERGY alert with an author and a timestamp. Concatenating
  // them printed "NSAIDS, AUGMENTIN, PCM, NSAIDS" on staging — a repeat that
  // reads as two separate findings and makes the chip look careless about the
  // one thing it must be exact about.
  //
  // Display-layer only: neither store is touched, and the FIRST spelling wins
  // so the patient's own words survive rather than a later re-entry's casing.
  const seen = new Set<string>();
  return words.filter((word) => {
    const key = word.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The combined state.
 *
 * A MEDICAL alert on record means somebody asked, so it can only move the
 * state TOWARDS "present" — it can never turn a recorded allergy back into
 * "not asked".
 */
export function allergyBannerState(
  allergies: string[] | null | undefined,
  medicalAlertLabels: string[] = [],
): AllergyRecordState {
  if (allergyWords(allergies, medicalAlertLabels).length > 0) return 'PRESENT';
  return allergyRecordState(allergies);
}

/**
 * The heading on the OTHER alerts line. Deliberately not a warning word:
 * a chronic condition is context, and dressing it as an alarm is what made the
 * red chip unreadable in the first place.
 */
export const OTHER_ALERTS_PREFIX = 'Also on record:';

/** The strip's text, or null where there should be no strip at all. */
export function allergyStripText(
  allergies: string[] | null | undefined,
  medicalAlertLabels: string[] = [],
): string | null {
  const state = allergyBannerState(allergies, medicalAlertLabels);
  if (state === 'NONE_KNOWN') return null;
  if (state === 'NONE_RECORDED') return ALLERGY_NOT_ASKED;
  const words = allergyWords(allergies, medicalAlertLabels).join(', ');
  return `${ALLERGY_STRIP_PREFIX} ${words} ${ALLERGY_STRIP_SUFFIX}`;
}

interface AllergyStripProps {
  allergies: string[] | null | undefined;
  /** Tightens the padding where the strip sits inside a modal or a form. */
  compact?: boolean;
  /** b1.5 PHASE D — labels of the patient's active MEDICAL alerts. */
  medicalAlertLabels?: string[];
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
export function AllergyStrip({ allergies, compact, medicalAlertLabels = [] }: AllergyStripProps) {
  const medical = medicalAlertLabels;
  const text = allergyStripText(allergies, medical);
  if (!text) return null;

  return (
    <div
      className={`kw-allergy-strip${compact ? ' kw-allergy-strip-compact' : ''}`}
      // role=status, not role=alert. Assertive announcements interrupt what a
      // screen-reader user is reading, and this is a standing condition rather
      // than something that just happened.
      role="status"
      data-allergy-strip={allergyBannerState(allergies, medical)}
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
 * A failed or missing alerts response degrades to the patient's own allergies
 * field — the behaviour before this existed — rather than to a blank screen.
 */
export function PatientAllergyStrip({
  allergies,
  patientId,
  compact,
}: {
  allergies: string[] | null | undefined;
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
      <AllergyStrip allergies={allergies} compact={compact} medicalAlertLabels={allergyLabels} />
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
