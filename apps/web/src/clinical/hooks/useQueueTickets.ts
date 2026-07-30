import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import { AddToQueueDto, QueueTicket, QueueTicketStatus } from '../types';

export interface QueueTicketFilter {
  [key: string]: string | undefined;
  clinicId?: string;
  status?: QueueTicketStatus;
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

export function useQueueTickets(filter: QueueTicketFilter = {}) {
  return useQuery({
    queryKey: ['queue-tickets', filter],
    queryFn: () => apiClient.get<QueueTicket[]>(`/queue-tickets${toQueryString(filter)}`),
    refetchInterval: 10_000,
  });
}

export function useAddToQueue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: AddToQueueDto) => apiClient.post<QueueTicket>('/queue-tickets', dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['queue-tickets'] }),
  });
}

function useQueueTicketAction(action: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input?: { cancelReason?: string } }) =>
      apiClient.patch<QueueTicket>(`/queue-tickets/${id}/${action}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['queue-tickets'] }),
  });
}

export const useCallTicket = () => useQueueTicketAction('call');
export const useArrivedTicket = () => useQueueTicketAction('arrived');
export const useMoveToDispensary = () => useQueueTicketAction('move-to-dispensary');
export const useCompleteTicket = () => useQueueTicketAction('complete');
export const useCancelTicket = () => useQueueTicketAction('cancel');
