import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import {
  ClaimBatch,
  CreateClaimBatchDto,
  Invoice,
  OutstandingClaimBatch,
  RecordClaimLinePaymentDto,
  SubmitClaimBatchDto,
} from '../types';

function invalidateClaims(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['claim-batches'] });
  queryClient.invalidateQueries({ queryKey: ['claim-eligible-invoices'] });
  queryClient.invalidateQueries({ queryKey: ['claim-outstanding'] });
}

export function useEligibleClaimInvoices(panelClinicId?: string) {
  return useQuery({
    queryKey: ['claim-eligible-invoices', panelClinicId],
    queryFn: () => apiClient.get<Invoice[]>(`/claim-batches/eligible-invoices?panelClinicId=${panelClinicId}`),
    enabled: Boolean(panelClinicId),
  });
}

export function useClaimBatches(panelClinicId?: string) {
  return useQuery({
    queryKey: ['claim-batches', panelClinicId],
    queryFn: () => apiClient.get<ClaimBatch[]>(`/claim-batches?panelClinicId=${panelClinicId}`),
    enabled: Boolean(panelClinicId),
  });
}

export function useOutstandingClaims() {
  return useQuery({
    queryKey: ['claim-outstanding'],
    queryFn: () => apiClient.get<OutstandingClaimBatch[]>('/claim-batches/outstanding'),
  });
}

export function useCreateClaimBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateClaimBatchDto) => apiClient.post<ClaimBatch>('/claim-batches', dto),
    onSuccess: () => invalidateClaims(queryClient),
  });
}

export function useSubmitClaimBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: SubmitClaimBatchDto }) =>
      apiClient.patch<ClaimBatch>(`/claim-batches/${id}/submit`, dto),
    onSuccess: () => invalidateClaims(queryClient),
  });
}

export function useRecordClaimLinePayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, lineId, dto }: { id: string; lineId: string; dto: RecordClaimLinePaymentDto }) =>
      apiClient.patch<ClaimBatch>(`/claim-batches/${id}/lines/${lineId}`, dto),
    onSuccess: () => invalidateClaims(queryClient),
  });
}

export function useReconcileClaimBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.patch<ClaimBatch>(`/claim-batches/${id}/reconcile`, {}),
    onSuccess: () => invalidateClaims(queryClient),
  });
}
