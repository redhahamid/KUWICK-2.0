import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import { CancelOrderServiceDto, CompleteOrderServiceDto, OrderService, OrderServiceStatus } from '../types';

export interface ProcedureQueueFilter {
  [key: string]: string | undefined;
  clinicId?: string;
  status?: OrderServiceStatus;
}

function toQueryString(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      search.set(key, value);
    }
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

export function useProcedureQueue(filter: ProcedureQueueFilter = {}) {
  return useQuery({
    queryKey: ['procedure-queue', filter],
    queryFn: () => apiClient.get<OrderService[]>(`/procedure-queue${toQueryString(filter)}`),
    refetchInterval: 10_000,
  });
}

export function useCompleteProcedure() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input?: CompleteOrderServiceDto }) =>
      apiClient.patch<OrderService>(`/procedure-queue/${id}/complete`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['procedure-queue'] }),
  });
}

// "Accept" a pending task — reuses OrderServiceController's generic
// start/cancel endpoints (a procedure-queue row IS an OrderService row,
// just filtered to TASK_ORDER), invalidating the procedure-queue query
// key instead of the per-visit one since this page is cross-visit.
export function useAcceptProcedure() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => apiClient.patch<OrderService>(`/order-services/${id}/start`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['procedure-queue'] }),
  });
}

export function useCancelProcedure() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input?: CancelOrderServiceDto }) =>
      apiClient.patch<OrderService>(`/order-services/${id}/cancel`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['procedure-queue'] }),
  });
}
