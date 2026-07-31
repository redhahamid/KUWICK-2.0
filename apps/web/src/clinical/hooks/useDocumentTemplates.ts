import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import { CreateDocumentTemplateDto, CustomDocumentTemplate, UpdateDocumentTemplateDto } from '../types';

// Document builder (D-040) — the clinic's own template catalog.
export function useDocumentTemplates(activeOnly = false) {
  return useQuery({
    queryKey: ['document-templates', activeOnly],
    queryFn: () =>
      apiClient.get<CustomDocumentTemplate[]>(`/document-templates${activeOnly ? '?activeOnly=true' : ''}`),
  });
}

export function useCreateDocumentTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateDocumentTemplateDto) => apiClient.post<CustomDocumentTemplate>('/document-templates', dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['document-templates'] }),
  });
}

export function useUpdateDocumentTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateDocumentTemplateDto }) =>
      apiClient.patch<CustomDocumentTemplate>(`/document-templates/${id}`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['document-templates'] }),
  });
}

export function useDeleteDocumentTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/document-templates/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['document-templates'] }),
  });
}
