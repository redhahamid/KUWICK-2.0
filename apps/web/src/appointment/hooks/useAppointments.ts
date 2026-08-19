import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import {
  Appointment,
  AvailableSlot,
  CreateAppointmentDto,
  RescheduleAppointmentDto,
} from '../types';

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

export interface AppointmentFilter {
  [key: string]: string | undefined;
  clinicId?: string;
  staffId?: string;
  patientId?: string;
  status?: string;
  from?: string;
  to?: string;
}

export function useAppointments(filter: AppointmentFilter = {}) {
  return useQuery({
    queryKey: ['appointments', filter],
    queryFn: () => apiClient.get<Appointment[]>(`/appointments${toQueryString(filter)}`),
  });
}

export interface AvailabilityQuery {
  [key: string]: string | undefined;
  staffId?: string;
  clinicId?: string;
  serviceId?: string;
  date?: string;
}

export function useAvailability(query: AvailabilityQuery) {
  const enabled = Boolean(query.staffId && query.clinicId && query.serviceId && query.date);
  return useQuery({
    queryKey: ['availability', query],
    queryFn: () => apiClient.get<AvailableSlot[]>(`/availability${toQueryString(query)}`),
    enabled,
  });
}

/**
 * Everything that has to be thrown away when an appointment moves.
 *
 * Named once because getting it wrong is invisible: a stale slot grid offers a
 * time that was taken thirty seconds ago, the server refuses it, and the
 * receptionist is told "no longer available" about a slot the screen is still
 * showing.
 */
function invalidateDiary(queryClient: ReturnType<typeof useQueryClient>): void {
  queryClient.invalidateQueries({ queryKey: ['appointments'] });
  queryClient.invalidateQueries({ queryKey: ['appointment-dashboard'] });
  queryClient.invalidateQueries({ queryKey: ['appointment-detail'] });
  queryClient.invalidateQueries({ queryKey: ['availability'] });
  queryClient.invalidateQueries({ queryKey: ['calendar-appointments'] });
}

export function useCreateAppointment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateAppointmentDto) => apiClient.post<Appointment>('/appointments', dto),
    onSuccess: () => invalidateDiary(queryClient),
  });
}

// Every lifecycle transition (confirm/cancel/no-show/arrived/reschedule)
// is the same shape at the HTTP level: PATCH /appointments/:id/<action>,
// invalidate the list on success. Payload type varies per action.
function useAppointmentAction<TInput = void>(action: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input?: TInput }) =>
      apiClient.patch<Appointment>(`/appointments/${id}/${action}`, input),
    onSuccess: () => invalidateDiary(queryClient),
  });
}

export const useConfirmAppointment = () => useAppointmentAction('confirm');
export const useNoShowAppointment = () => useAppointmentAction('no-show');
export const useArrivedAppointment = () => useAppointmentAction('arrived');
export const useCancelAppointment = () =>
  useAppointmentAction<{ cancelReason?: string; cancellationReason?: string }>('cancel');
export const useRescheduleAppointment = () =>
  useAppointmentAction<RescheduleAppointmentDto>('reschedule');
/** "They're here" without creating the visit yet — see the service. */
export const useMarkArrivedAppointment = () => useAppointmentAction('mark-arrived');
