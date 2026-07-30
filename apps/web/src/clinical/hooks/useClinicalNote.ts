import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import { ClinicalNote, UpsertClinicalNoteDto } from '../types';

export function useClinicalNote(visitId?: string) {
  return useQuery({
    queryKey: ['clinical-notes', visitId],
    queryFn: () => apiClient.get<ClinicalNote | null>(`/visits/${visitId}/clinical-note`),
    enabled: Boolean(visitId),
  });
}

export function useSaveClinicalNote(visitId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpsertClinicalNoteDto) =>
      apiClient.put<ClinicalNote>(`/visits/${visitId}/clinical-note`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['clinical-notes', visitId] }),
  });
}
