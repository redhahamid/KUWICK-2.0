import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import { AddDiagnosisDto, Diagnosis, DiagnosisCatalogEntry } from '../types';

export function useDiagnosisCatalogSearch(search: string) {
  return useQuery({
    queryKey: ['diagnosis-catalog', search],
    queryFn: () =>
      apiClient.get<DiagnosisCatalogEntry[]>(`/diagnosis-catalog?search=${encodeURIComponent(search)}`),
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

export function useRemoveDiagnosis(visitId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/diagnoses/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['diagnoses', visitId] }),
  });
}
