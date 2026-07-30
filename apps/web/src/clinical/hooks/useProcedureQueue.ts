import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import { CompleteOrderServiceDto, OrderService, OrderServiceStatus } from '../types';

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
