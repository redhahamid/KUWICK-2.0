import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createResourceHooks } from '../../core/hooks/use-crud-resource';
import { apiClient } from '../../core/api-client';
import { CreateServiceDto, Service, UpdateServiceDto } from '../types';

export const { useList: useServices, useCreate: useCreateService } = createResourceHooks<
  Service,
  CreateServiceDto
>('/services', 'services');

export function useUpdateService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateServiceDto }) =>
      apiClient.patch<Service>(`/services/${id}`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['services'] }),
  });
}
