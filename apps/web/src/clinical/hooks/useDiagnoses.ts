import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import {
  AddDiagnosisDto,
  CreateCustomDiagnosisDto,
  Diagnosis,
  DiagnosisCatalogCounts,
  DiagnosisCatalogEntry,
  DiagnosisCategory,
  DiagnosisPriority,
} from '../types';

export function useDiagnosisCatalogSearch(search: string, category?: DiagnosisCategory) {
  return useQuery({
    queryKey: ['diagnosis-catalog', search, category],
    queryFn: () =>
      apiClient.get<DiagnosisCatalogEntry[]>(
        `/diagnosis-catalog?search=${encodeURIComponent(search)}${category ? `&category=${category}` : ''}`,
      ),
    enabled: search.length > 0,
  });
}

export function useDiagnoses(visitId?: string) {
  return useQuery({
    queryKey: ['diagnoses', visitId],
    queryFn: () => apiClient.get<Diagnosis[]>(`/diagnoses?visitId=${visitId}`),
    enabled: Boolean(visitId),
  });
}

export function useAddDiagnosis(visitId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: AddDiagnosisDto) => apiClient.post<Diagnosis>('/diagnoses', dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['diagnoses', visitId] }),
  });
}

// G2a (D-059) — mark a diagnosis Primary, or clear its priority back to
// "not recorded". The server demotes any existing primary in the same
// transaction and a partial unique index settles concurrent requests, so the
// client never has to reason about who won.
export function useSetDiagnosisPriority(visitId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, priority }: { id: string; priority: DiagnosisPriority | null }) =>
      apiClient.patch<Diagnosis>(`/diagnoses/${id}/priority`, { priority }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['diagnoses', visitId] }),
  });
}

// G2 closure (D-061) — removal is an audited correction with a mandatory
// reason, not a delete. There is no DELETE endpoint left to call.
export function useRemoveDiagnosis(visitId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, removalReason, expectedVersion }: { id: string; removalReason: string; expectedVersion?: number }) =>
      apiClient.patch<Diagnosis>(`/diagnoses/${id}/removal`, { removalReason, expectedVersion }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['diagnoses', visitId] });
      queryClient.invalidateQueries({ queryKey: ['diagnosis-history', visitId] });
    },
  });
}

// The audit view: every diagnosis ever recorded for the visit, including the
// removed ones with their actor, time and reason.
export function useDiagnosisHistory(visitId?: string, enabled = false) {
  return useQuery({
    queryKey: ['diagnosis-history', visitId],
    queryFn: () => apiClient.get<Diagnosis[]>(`/diagnoses/history?visitId=${visitId}`),
    enabled: Boolean(visitId) && enabled,
  });
}

// The Diagnoses Directory admin screen (D-027, docs/DECISIONS.md).
export function useDiagnosisDirectory(category?: DiagnosisCategory) {
  return useQuery({
    queryKey: ['diagnosis-directory', category],
    queryFn: () =>
      apiClient.get<DiagnosisCatalogEntry[]>(
        `/diagnosis-catalog/directory${category ? `?category=${category}` : ''}`,
      ),
  });
}

export function useDiagnosisCatalogCounts() {
  return useQuery({
    queryKey: ['diagnosis-catalog-counts'],
    queryFn: () => apiClient.get<DiagnosisCatalogCounts>('/diagnosis-catalog/counts'),
  });
}

export function useCreateCustomDiagnosis() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateCustomDiagnosisDto) =>
      apiClient.post<DiagnosisCatalogEntry>('/diagnosis-catalog/custom', dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['diagnosis-directory'] });
      queryClient.invalidateQueries({ queryKey: ['diagnosis-catalog-counts'] });
    },
  });
}

export function useSetDiagnosisCatalogActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      apiClient.patch<DiagnosisCatalogEntry>(`/diagnosis-catalog/${id}/active`, { active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['diagnosis-directory'] });
      queryClient.invalidateQueries({ queryKey: ['diagnosis-catalog-counts'] });
    },
  });
}

export function useBulkActivateDiagnosisCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ category, active }: { category: DiagnosisCategory; active: boolean }) =>
      apiClient.patch(`/diagnosis-catalog/category/${category}/active`, { active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['diagnosis-directory'] });
      queryClient.invalidateQueries({ queryKey: ['diagnosis-catalog-counts'] });
    },
  });
}
