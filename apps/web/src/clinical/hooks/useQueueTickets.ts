import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import {
  AddToQueueDto,
  CreateRoomDto,
  PublicQueueMonitorData,
  QueueDisplayConfig,
  QueueTicket,
  QueueTicketStatus,
  Room,
  UpdateQueueDisplayConfigDto,
} from '../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

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
    mutationFn: ({ id, input }: { id: string; input?: { cancelReason?: string; roomId?: string; staffId?: string } }) =>
      apiClient.patch<QueueTicket>(`/queue-tickets/${id}/${action}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['queue-tickets'] }),
  });
}

export const useCallTicket = () => useQueueTicketAction('call');
export const useArrivedTicket = () => useQueueTicketAction('arrived');
export const useMoveToDispensary = () => useQueueTicketAction('move-to-dispensary');
export const useCompleteTicket = () => useQueueTicketAction('complete');
export const useCancelTicket = () => useQueueTicketAction('cancel');

// D-038 — rooms/stations a patient can be called to.
export function useRooms(clinicId?: string, activeOnly = false) {
  return useQuery({
    queryKey: ['rooms', clinicId, activeOnly],
    queryFn: () =>
      apiClient.get<Room[]>(`/rooms${toQueryString({ clinicId, activeOnly: activeOnly ? 'true' : undefined })}`),
    enabled: !!clinicId,
  });
}

export function useCreateRoom() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateRoomDto) => apiClient.post<Room>('/rooms', dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rooms'] }),
  });
}

export function useUpdateRoom() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: { name?: string; active?: boolean } }) =>
      apiClient.patch<Room>(`/rooms/${id}`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rooms'] }),
  });
}

// D-038 — per-clinic waiting-room monitor settings.
export function useQueueDisplayConfig(clinicId?: string) {
  return useQuery({
    queryKey: ['queue-display-config', clinicId],
    queryFn: () => apiClient.get<QueueDisplayConfig>(`/queue-tickets/display-config?clinicId=${clinicId}`),
    enabled: !!clinicId,
  });
}

export function useUpdateQueueDisplayConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ clinicId, dto }: { clinicId: string; dto: UpdateQueueDisplayConfigDto }) =>
      apiClient.put<QueueDisplayConfig>(`/queue-tickets/display-config?clinicId=${clinicId}`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['queue-display-config'] }),
  });
}

// The waiting-room TV's data source — a raw fetch against the
// unauthenticated public endpoint, NOT apiClient: the monitor has no login
// and must never get bounced to /login by the 401-refresh flow.
export function usePublicQueueMonitor(clinicId?: string) {
  return useQuery({
    queryKey: ['public-queue-monitor', clinicId],
    queryFn: async () => {
      const response = await fetch(`${API_BASE_URL}/public/queue/${clinicId}`);
      if (!response.ok) {
        throw new Error(`Monitor data fetch failed (${response.status})`);
      }
      return (await response.json()) as PublicQueueMonitorData;
    },
    enabled: !!clinicId,
    refetchInterval: 5_000,
  });
}
