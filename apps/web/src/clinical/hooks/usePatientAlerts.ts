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

export type PatientAlertType = 'MEDICAL' | 'ACCESSIBILITY' | 'COMMUNICATION' | 'ADMINISTRATIVE';

export interface PatientAlert {
  id: string;
  patientId: string;
  type: PatientAlertType;
  label: string;
  note: string | null;
  active: boolean;
  createdAt: string;
  createdByStaffId: string;
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
