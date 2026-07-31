import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import { ClinicalDocument, CreateDocumentDto } from '../types';

export function useDocuments(visitId?: string) {
  return useQuery({
    queryKey: ['documents', visitId],
    queryFn: () => apiClient.get<ClinicalDocument[]>(`/documents?visitId=${visitId}`),
    enabled: Boolean(visitId),
  });
}

export function useCreateDocument(visitId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateDocumentDto) => apiClient.post<ClinicalDocument>('/documents', dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documents', visitId] }),
  });
}

export function useDeleteDocument(visitId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/documents/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documents', visitId] }),
  });
}

// Dispensary "prep, sign MC" step (Phase A6).
export function useSignDocument(visitId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, staffId }: { id: string; staffId: string }) =>
      apiClient.patch<ClinicalDocument>(`/documents/${id}/sign`, { staffId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documents', visitId] }),
  });
}
