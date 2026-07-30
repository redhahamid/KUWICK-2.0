import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ProcurementRequestStatus } from '@kuwick/shared';
import { apiClient } from '../../core/api-client';
import { CreateProcurementRequestDto, ProcurementRequest } from '../types';

export interface ProcurementRequestFilter {
  [key: string]: string | undefined;
  clinicId?: string;
  status?: ProcurementRequestStatus;
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

export function useProcurementRequests(filter: ProcurementRequestFilter = {}) {
  return useQuery({
    queryKey: ['procurement-requests', filter],
    queryFn: () => apiClient.get<ProcurementRequest[]>(`/procurement-requests${toQueryString(filter)}`),
  });
}

export function useCreateProcurementRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateProcurementRequestDto) =>
      apiClient.post<ProcurementRequest>('/procurement-requests', dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['procurement-requests'] }),
  });
}

function useProcurementRequestAction(action: 'approve' | 'reject') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.patch<ProcurementRequest>(`/procurement-requests/${id}/${action}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['procurement-requests'] }),
  });
}

export const useApproveProcurementRequest = () => useProcurementRequestAction('approve');
export const useRejectProcurementRequest = () => useProcurementRequestAction('reject');
