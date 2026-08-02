import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import {
  AmendClinicalNoteDto,
  ClinicalNote,
  ClinicalNoteRevision,
  SignClinicalNoteDto,
  UpsertClinicalNoteDto,
} from '../types';

// D-044 — many-per-visit, newest first. C0 (D-051) added authorship, signing
// and amendments; vitals moved out to useVisitObservations.
export function useClinicalNotes(visitId?: string) {
  return useQuery({
    queryKey: ['clinical-notes', visitId],
    queryFn: () => apiClient.get<ClinicalNote[]>(`/visits/${visitId}/clinical-notes`),
    enabled: Boolean(visitId),
  });
}

// Convenience wrapper for consumers that only care about the most recent
// note (document merge fields) — same query/cache, narrowed to one record.
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

// The signer is ALWAYS the authenticated caller — the DTO carries only the
// expected version, so there is nothing to spoof.
export function useSignClinicalNote(visitId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: SignClinicalNoteDto }) =>
      apiClient.post<ClinicalNote>(`/visits/${visitId}/clinical-notes/${id}/sign`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['clinical-notes', visitId] }),
  });
}

// An amendment creates a NEW note linked to the signed original; the
// original is never modified.
export function useAmendClinicalNote(visitId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: AmendClinicalNoteDto }) =>
      apiClient.post<ClinicalNote>(`/visits/${visitId}/clinical-notes/${id}/amend`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['clinical-notes', visitId] }),
  });
}

export function useClinicalNoteRevisions(visitId?: string, noteId?: string) {
  return useQuery({
    queryKey: ['clinical-note-revisions', noteId],
    queryFn: () =>
      apiClient.get<ClinicalNoteRevision[]>(`/visits/${visitId}/clinical-notes/${noteId}/revisions`),
    enabled: Boolean(visitId && noteId),
  });
}
