import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createResourceHooks } from '../../core/hooks/use-crud-resource';
import { apiClient } from '../../core/api-client';
import { Staff, CreateStaffDto, UpdateStaffDto } from '../types';

export const { useList: useStaff, useCreate: useCreateStaff } = createResourceHooks<
  Staff,
  CreateStaffDto
>('/staff', 'staff');

export function useUpdateStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateStaffDto }) =>
      apiClient.patch<Staff>(`/staff/${id}`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staff'] }),
  });
}
