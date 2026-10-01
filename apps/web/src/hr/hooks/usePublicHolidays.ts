import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createResourceHooks } from '../../core/hooks/use-crud-resource';
import { apiClient } from '../../core/api-client';
import { CreatePublicHolidayDto, PublicHoliday, UpdatePublicHolidayDto } from '../types';

export const { useList: usePublicHolidays, useCreate: useCreatePublicHoliday } = createResourceHooks<
  PublicHoliday,
  CreatePublicHolidayDto
>('/public-holidays', 'public-holidays');

export function useUpdatePublicHoliday() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdatePublicHolidayDto & { id: string }) => apiClient.patch<PublicHoliday>(`/public-holidays/${id}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['public-holidays'] }),
  });
}

export function useDeletePublicHoliday() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/public-holidays/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['public-holidays'] }),
  });
}
