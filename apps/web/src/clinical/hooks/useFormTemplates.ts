import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import { CreateFormTemplateDto, FormTemplate, UpdateFormTemplateDto } from '../types';

// Returns null when the service has no form — an expected state, not an
// error (see form-template.controller.ts).
export function useFormTemplateForService(serviceCatalogId?: string) {
  return useQuery({
    queryKey: ['form-template', serviceCatalogId],
    queryFn: () => apiClient.get<FormTemplate | null>(`/form-templates?serviceCatalogId=${serviceCatalogId}`),
    enabled: Boolean(serviceCatalogId),
  });
}

export function useCreateFormTemplate(serviceCatalogId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateFormTemplateDto) => apiClient.post<FormTemplate>('/form-templates', dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['form-template', serviceCatalogId] }),
  });
}

export function useUpdateFormTemplate(serviceCatalogId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateFormTemplateDto }) =>
      apiClient.patch<FormTemplate>(`/form-templates/${id}`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['form-template', serviceCatalogId] }),
  });
}
