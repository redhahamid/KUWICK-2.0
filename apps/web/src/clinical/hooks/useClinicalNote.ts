import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import { ClinicalNote, UpsertClinicalNoteDto } from '../types';

// D-044 — many-per-visit (a consultation can carry several notes, e.g.
// triage vitals then a reassessment after a nebuliser), ordered newest
// first by the backend.
export function useClinicalNotes(visitId?: string) {
  return useQuery({
    queryKey: ['clinical-notes', visitId],
    queryFn: () => apiClient.get<ClinicalNote[]>(`/visits/${visitId}/clinical-notes`),
    enabled: Boolean(visitId),
  });
}

// Convenience wrapper for consumers that only care about the most recent
// note (weight-based dosage calculator, document merge fields) — same
// query/cache as useClinicalNotes, just narrowed to a single record.
export function useLatestClinicalNote(visitId?: string) {
  const query = useClinicalNotes(visitId);
  return { ...query, data: query.data?.[0] ?? null };
}

export function useCreateClinicalNote(visitId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpsertClinicalNoteDto) =>
      apiClient.post<ClinicalNote>(`/visits/${visitId}/clinical-notes`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['clinical-notes', visitId] }),
  });
}

export function useUpdateClinicalNote(visitId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpsertClinicalNoteDto }) =>
      apiClient.patch<ClinicalNote>(`/visits/${visitId}/clinical-notes/${id}`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['clinical-notes', visitId] }),
  });
}
