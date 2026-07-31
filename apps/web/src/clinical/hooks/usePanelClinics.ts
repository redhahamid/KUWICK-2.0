import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createResourceHooks } from '../../core/hooks/use-crud-resource';
import { apiClient } from '../../core/api-client';
import { CreatePanelClinicDto, PanelClinic, UpdatePanelClinicDto } from '../types';

export const { useList: usePanelClinics, useCreate: useCreatePanelClinic } = createResourceHooks<
  PanelClinic,
  CreatePanelClinicDto
>('/panel-clinics', 'panel-clinics');

export function useUpdatePanelClinic() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdatePanelClinicDto }) =>
      apiClient.patch<PanelClinic>(`/panel-clinics/${id}`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['panel-clinics'] }),
  });
}
