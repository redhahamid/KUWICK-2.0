import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import { useLatestClinicalNote } from './useClinicalNote';
import { CorrectObservationDto, RecordObservationDto, VisitObservation } from '../types';

// C0 (D-051) — vitals with their own recorder attribution, separate from the
// doctor's narrative. Newest-first from the backend.
export function useVisitObservations(visitId?: string) {
  return useQuery({
    queryKey: ['visit-observations', visitId],
    queryFn: () => apiClient.get<VisitObservation[]>(`/visits/${visitId}/observations`),
    enabled: Boolean(visitId),
  });
}

// The most recent observation set for a visit — what document merge fields
// and the weight-based dosage calculator want.
export function useLatestObservation(visitId?: string) {
  const query = useVisitObservations(visitId);
  return { ...query, data: query.data?.[0] ?? null };
}

// The vitals fields shared by VisitObservation and the FROZEN legacy vitals
// columns still present on ClinicalNote. Same names on both, so consumers
// (document merge fields, the dosage calculator) can read either.
export interface VitalsSource {
  bpSystolic: number | null;
  bpDiastolic: number | null;
  pulse: number | null;
  temperature: string | null;
  spo2: number | null;
  respRate: number | null;
  weight: string | null;
  height: string | null;
  glucose: string | null;
}

// C0 (D-051) transition read path: prefer a real attributed observation, and
// fall back to a legacy note's frozen vitals columns for visits recorded
// before the split. Writes only ever go to VisitObservation — there is no
// dual-write, because two writable copies of the same fact would diverge.
export function useLatestVitals(visitId?: string): VitalsSource | null {
  const { data: observation } = useLatestObservation(visitId);
  const { data: legacyNote } = useLatestClinicalNote(visitId);
  return observation ?? legacyNote ?? null;
}

// A NEW reading (e.g. repeat BP after treatment) — never overwrites an
// earlier set.
export function useRecordObservation(visitId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: RecordObservationDto) =>
      apiClient.post<VisitObservation>(`/visits/${visitId}/observations`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['visit-observations', visitId] }),
  });
}

// Correcting an inaccurate entry — requires a reason, preserves the previous
// values in an immutable revision, and keeps the original recorder.
export function useCorrectObservation(visitId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: CorrectObservationDto }) =>
      apiClient.patch<VisitObservation>(`/visits/${visitId}/observations/${id}`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['visit-observations', visitId] }),
  });
}
