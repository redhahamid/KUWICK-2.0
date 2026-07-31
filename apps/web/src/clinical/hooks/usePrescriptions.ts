import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import { CancelPrescriptionDto, CopyPrescriptionsDto, CreatePrescriptionDto, Prescription, Visit } from '../types';

export function usePrescriptions(visitId?: string) {
  return useQuery({
    queryKey: ['prescriptions', visitId],
    queryFn: () => apiClient.get<Prescription[]>(`/prescriptions?visitId=${visitId}`),
    enabled: Boolean(visitId),
  });
}

// Powers the "Copy Previous Prescription" date picker.
export function usePrescriptionCopySources(patientId?: string, excludeVisitId?: string) {
  return useQuery({
    queryKey: ['prescription-copy-sources', patientId, excludeVisitId],
    queryFn: () =>
      apiClient.get<Visit[]>(
        `/prescriptions/copy-sources?patientId=${patientId}${excludeVisitId ? `&excludeVisitId=${excludeVisitId}` : ''}`,
      ),
    enabled: Boolean(patientId),
  });
}

export function useCreatePrescription(visitId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreatePrescriptionDto) => apiClient.post<Prescription>('/prescriptions', dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['prescriptions', visitId] }),
  });
}

export function useCopyPrescriptions(visitId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CopyPrescriptionsDto) => apiClient.post<Prescription[]>('/prescriptions/copy', dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['prescriptions', visitId] }),
  });
}

function usePrescriptionAction(visitId: string | undefined, action: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input?: CancelPrescriptionDto }) =>
      apiClient.patch<Prescription>(`/prescriptions/${id}/${action}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['prescriptions', visitId] }),
  });
}

export const useDispensePrescription = (visitId?: string) => usePrescriptionAction(visitId, 'dispense');
export const useCancelPrescription = (visitId?: string) => usePrescriptionAction(visitId, 'cancel');

export function useRemovePrescription(visitId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/prescriptions/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['prescriptions', visitId] }),
  });
}
