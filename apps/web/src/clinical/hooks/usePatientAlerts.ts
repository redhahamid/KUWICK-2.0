import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';

/**
 * b1.5 PHASE D — patient alerts, in the browser.
 *
 * Standing facts about a person: allergies, chronic conditions, a wheelchair,
 * a language, an outstanding balance. The API already owns the rules — the
 * author comes from the session, MEDICAL alerts need their own permission, and
 * there is no DELETE route because the table has no DELETE policy. None of
 * that is re-derived here.
 */

export type PatientAlertType =
  /** DO NOT PRESCRIBE. Feeds the allergy chip and the prescribing banner. */
  | 'ALLERGY'
  /**
   * The CONFIRMED NEGATIVE — somebody asked, and the answer was none.
   *
   * It exists because absence cannot say this. No ALLERGY alert means nobody
   * has recorded one, which is the same shape as nobody having asked, and the
   * difference between those two is the whole reason the banner has three
   * states. `patient.allergies = []` used to carry it; this carries it now,
   * with an author and a timestamp the array never had.
   */
  | 'NO_KNOWN_ALLERGY'
  /** Take into account — chronic conditions, pregnancy, anticoagulation. */
  | 'MEDICAL'
  | 'ACCESSIBILITY'
  | 'COMMUNICATION'
  | 'ADMINISTRATIVE';

export interface PatientAlert {
  id: string;
  patientId: string;
  type: PatientAlertType;
  label: string;
  note: string | null;
  active: boolean;
  createdAt: string;
  /**
   * Null ONLY on a row carried over from the old `patient.allergies` field,
   * which had no author to name. A database CHECK refuses an unattributed row
   * from anywhere else.
   */
  createdByStaffId: string | null;
  /**
   * HUMAN — somebody recorded this. MIGRATED — carried over from the free-text
   * allergy field, where nobody knows who typed it. Surfaces say so in words
   * rather than filling the blank with "System", which would read as an author.
   */
  origin?: 'HUMAN' | 'MIGRATED';
  /** Resolved server-side for the audit line. Null where the staff row is gone. */
  createdByName: string | null;
  deactivatedAt: string | null;
  deactivatedByName: string | null;
}

/**
 * The full history, active AND retired.
 *
 * Retired alerts are not noise: "penicillin allergy, retired by Dr X on the
 * 3rd" is the record of a clinical decision, and hiding it would leave the
 * profile unable to answer why something is no longer showing. Surfaces that
 * want only the live ones filter `active` themselves.
 */
export function usePatientAlerts(patientId: string | undefined) {
  return useQuery({
    queryKey: ['patient-alerts', patientId],
    // `?? []` is not defensive noise. This query feeds the ALLERGY BANNER on
    // four prescribing surfaces, and React Query treats an undefined result as
    // a hard error — an empty body or a 204 would therefore throw inside the
    // strip and take the prescribing screen down with it. "No alerts on
    // record" is the correct reading of nothing, and the banner still falls
    // back to the patient's own allergies field.
    queryFn: async () => {
      const rows = await apiClient.get<PatientAlert[]>(`/patients/${patientId}/alerts`);
      return Array.isArray(rows) ? rows : [];
    },
    enabled: Boolean(patientId),
  });
}

function useAlertInvalidation(patientId: string | undefined) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['patient-alerts', patientId] });
    // The allergy banner reads MEDICAL alerts, and it is rendered from visit
    // data on three surfaces. Recording an allergy that leaves those banners
    // saying "not asked" is the defect this whole phase is closing.
    queryClient.invalidateQueries({ queryKey: ['visits'] });
  };
}

export interface CreatePatientAlertDto {
  type: PatientAlertType;
  label: string;
  note?: string;
}

export function useCreatePatientAlert(patientId: string | undefined) {
  const invalidate = useAlertInvalidation(patientId);
  return useMutation({
    mutationFn: (dto: CreatePatientAlertDto) =>
      apiClient.post<PatientAlert>(`/patients/${patientId}/alerts`, dto),
    onSuccess: invalidate,
  });
}

/**
 * Retire an alert. There is no delete, here or anywhere.
 *
 * The row stays, stamped with who retired it and when — the same append-only
 * shape the table itself enforces. A resolved allergy is a clinical event with
 * an author, not an absence of data.
 */
export function useDeactivatePatientAlert(patientId: string | undefined) {
  const invalidate = useAlertInvalidation(patientId);
  return useMutation({
    mutationFn: (id: string) => apiClient.patch<PatientAlert>(`/patient-alerts/${id}/deactivate`),
    onSuccess: invalidate,
  });
}

/**
 * The live ones, in the order the API already sorted them.
 *
 * Guards the shape as well as the absence. This feeds the allergy banner on
 * four prescribing surfaces, and a component whose whole job is to warn about
 * allergies is the last one that should be able to crash the page it warns on.
 */
export function activeAlerts(alerts: PatientAlert[] | undefined): PatientAlert[] {
  if (!Array.isArray(alerts)) return [];
  return alerts.filter((alert) => alert?.active);
}

/**
 * b1.5 FIX 3 — THE SPLIT, in one place.
 *
 * An allergy and a chronic condition are different instructions: one forbids a
 * prescription, the other qualifies it. The header chip rendered them as one
 * red line — "NSAIDS, AUGMENTIN, PCM, DM, HPT, OKU" — leaving a doctor to work
 * out which of six words was which, which is the work the chip existed to save.
 *
 * Split by the STORED type, never by reading the label. A row saying
 * "Penicillin allergy" is almost certainly an allergy, and "almost certainly"
 * is not a basis for putting something on, or leaving it off, a
 * do-not-prescribe list.
 */
export function allergyAlerts(alerts: PatientAlert[] | undefined): PatientAlert[] {
  return activeAlerts(alerts).filter((alert) => alert.type === 'ALLERGY');
}

/**
 * Everything else that is live — chronic conditions, access needs, admin flags.
 *
 * Includes MEDICAL, which is where allergies recorded before the ALLERGY type
 * existed still sit. They are not silently reclassified, and they are not
 * hidden either: they show here until a clinician re-records them.
 */
export function nonAllergyAlerts(alerts: PatientAlert[] | undefined): PatientAlert[] {
  return activeAlerts(alerts).filter(
    // NO_KNOWN_ALLERGY is excluded as well as ALLERGY. It belongs to the
    // allergy question, and rendering "No known allergy" under "Also on
    // record:" alongside the wheelchair and the language would read as a
    // finding rather than as the answer to a question.
    (alert) => alert.type !== 'ALLERGY' && alert.type !== 'NO_KNOWN_ALLERGY',
  );
}

/**
 * The confirmed negative, if somebody recorded one.
 *
 * Only meaningful when there is no ALLERGY alert: a patient can have been
 * asked, answered none, and later turned out to react to something. In that
 * order the allergies win, and the stale negative is simply outranked rather
 * than treated as a contradiction the UI has to resolve.
 */
export function noKnownAllergyAlerts(alerts: PatientAlert[] | undefined): PatientAlert[] {
  return activeAlerts(alerts).filter((alert) => alert.type === 'NO_KNOWN_ALLERGY');
}

/**
 * b1.5 FIX 1 — how many alert labels the header shows before it collapses.
 *
 * A CAP rather than a measurement. "As many as fit" is the intent, and the
 * honest way to implement it in a wrapping flex band is a number that fits the
 * narrowest supported viewport (1366px, which the A0 sweep pins) with the
 * allergy chip, the payer chip and three action buttons already in the row.
 * Three labels clear that; a measured version would reflow on every render and
 * still have to pick a number when the labels are long.
 */
export const HEADER_ALERT_LIMIT = 3;

export interface HeaderAlertSummary {
  /** Rendered in full, in order. */
  shown: string[];
  /** How many did not fit. Zero means nothing was collapsed. */
  hidden: number;
}

/**
 * Show the content, collapse only the REMAINDER.
 *
 * The header used to render a bare count — "1 alert" — which a doctor had to
 * click before learning it said DM. Information you have to click for is
 * information you do not have mid-consult, which is the opposite of what an
 * alert is for. So the labels themselves go in the band, and only the overflow
 * becomes a number.
 */
export function headerAlertSummary(
  labels: string[],
  limit: number = HEADER_ALERT_LIMIT,
): HeaderAlertSummary {
  // A limit of one leaves "X +2 more", which is still more use than "3 alerts".
  const safeLimit = Math.max(1, limit);
  if (labels.length <= safeLimit) return { shown: labels, hidden: 0 };
  return { shown: labels.slice(0, safeLimit), hidden: labels.length - safeLimit };
}

