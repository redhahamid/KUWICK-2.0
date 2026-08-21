import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';

export interface StaffNotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  clinicId: string;
  clinicName: string;
  appointmentId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface StaffNotificationInbox {
  unread: number;
  rows: StaffNotificationRow[];
}

/**
 * ONE dictionary for the words a notification type wears, shared by the
 * toast, the bell and the list — so the same event can never be called two
 * different things on two surfaces. Unknown codes fall back to the stored
 * title, which the API always writes.
 */
export const NOTIFICATION_TYPE_WORDS: Record<string, string> = {
  NEW_BOOKING: 'New appointment',
  BOOKING_REQUEST: 'Booking request',
  REQUEST_ACCEPTED: 'Request accepted',
  REQUEST_DECLINED: 'Request declined',
  PATIENT_CANCELLED: 'Cancelled by patient',
  PATIENT_RESCHEDULED: 'Rescheduled by patient',
  WAITLIST_ADDED: 'Waitlist',
  RESCHEDULE_REQUESTED: 'Reschedule request',
  CANCELLATION_REQUESTED: 'Cancellation request',
  CHANGE_REQUEST_DECIDED: 'Request decided',
};

export function notificationWord(row: Pick<StaffNotificationRow, 'type' | 'title'>): string {
  return NOTIFICATION_TYPE_WORDS[row.type] ?? row.title;
}

/**
 * PHASE 5 — the signed-in staff member's inbox, POLLED. No websocket
 * infrastructure exists and this does not pretend otherwise: a 30-second
 * poll is honest near-real-time for a front desk, and the bell simply
 * re-renders when the answer changes.
 */
export function useStaffNotifications(enabled = true) {
  return useQuery({
    queryKey: ['staff-notifications'],
    queryFn: () => apiClient.get<StaffNotificationInbox>('/staff-notifications?take=30'),
    enabled,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    placeholderData: (previous) => previous,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.patch(`/staff-notifications/${id}/read`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staff-notifications'] }),
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.post('/staff-notifications/read-all', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staff-notifications'] }),
  });
}
