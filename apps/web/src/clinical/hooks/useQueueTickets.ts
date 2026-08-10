import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import {
  AddToQueueDto,
  CompleteVisitDto,
  CreateRoomDto,
  QueueBoard,
  PublicQueueMonitorData,
  QueueDisplayConfig,
  QueueTicket,
  QueueTicketStatus,
  Room,
  UpdateQueueDisplayConfigDto,
  VisitCompletionResult,
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

/**
 * KW2-C2 — pause the consultation, and take the patient back.
 *
 * Both refresh the QUEUE and the VISIT, and nothing else. A hold moves the
 * patient's place in the queue; it does not change a diagnosis, a
 * prescription or a word of the clinical note, so nothing that owns those is
 * invalidated. In particular the note query is never named here: refetching
 * it would remount the editor and take an unsaved draft with it (C1/D-091),
 * which is the opposite of "resuming returns them with state intact".
 *
 * There is no request body. The acting user comes from the session, so there
 * is nothing for a client to assert about who paused the consultation.
 */
function useHoldAction(action: 'hold' | 'resume') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketId }: { ticketId: string; visitId?: string; patientId?: string }) =>
      apiClient.patch<QueueTicket>(`/queue-tickets/${ticketId}/${action}`),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['queue-tickets'] });
      queryClient.invalidateQueries({ queryKey: ['queue-board'] });
      // The visit AND the patient's visit list. The Canvas header reads the
      // selected visit out of the LIST, so invalidating only the single-visit
      // key left the band claiming "In Consult" for a patient who had just
      // been sent back to the waiting room — the exact silent disagreement
      // this feature exists to prevent.
      if (variables.visitId) {
        queryClient.invalidateQueries({ queryKey: ['visits', variables.visitId] });
      }
      if (variables.patientId) {
        queryClient.invalidateQueries({ queryKey: ['visits', 'patient', variables.patientId] });
      }
    },
  });
}

export const useHoldConsultation = () => useHoldAction('hold');
export const useResumeConsultation = () => useHoldAction('resume');

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

// ---------------------------------------------------------------------------
// G4.5d3c-3b (D-095) — the six-stage queue board and Complete Visit.
// ---------------------------------------------------------------------------
export function useQueueBoard(clinicId?: string) {
  return useQuery({
    queryKey: ['queue-board', clinicId],
    queryFn: () => apiClient.get<QueueBoard>(`/queue-tickets/board?clinicId=${clinicId}`),
    enabled: Boolean(clinicId),
    refetchInterval: 15_000,
  });
}

/**
 * Closes the visit through the AUTHORITATIVE completion service — the same
 * `PATCH /visits/:id/complete` the doctor-side status read describes, never a
 * queue-only shortcut. Refreshes the board, the ticket list and the visit.
 */
export function useCompleteVisit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ visitId, dto }: { visitId: string; dto?: CompleteVisitDto }) =>
      apiClient.patch<VisitCompletionResult>(`/visits/${visitId}/complete`, dto ?? {}),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['queue-board'] });
      queryClient.invalidateQueries({ queryKey: ['queue-tickets'] });
      queryClient.invalidateQueries({ queryKey: ['visit', variables.visitId] });
      queryClient.invalidateQueries({ queryKey: ['completion-blockers', variables.visitId] });
    },
  });
}
