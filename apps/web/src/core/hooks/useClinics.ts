import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createResourceHooks } from './use-crud-resource';
import { apiClient } from '../api-client';
import { Clinic, CreateClinicDto, UpdateClinicDto } from '../types';

export const { useList: useClinics, useCreate: useCreateClinic } = createResourceHooks<
  Clinic,
  CreateClinicDto
>('/clinics', 'clinics');

export function useUpdateClinic() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateClinicDto }) =>
      apiClient.patch<Clinic>(`/clinics/${id}`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['clinics'] }),
  });
}
