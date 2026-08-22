import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';

export interface AppointmentEventRow {
  id: string;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  reason: string | null;
  actorLabel: string | null;
  occurredAt: string;
  beforeValue: unknown;
  afterValue: unknown;
}

export interface AppointmentDetail {
  id: string;
  status: string;
  source: string;
  sourceDetail: string | null;
  clinicId: string;
  staffId: string;
  serviceId: string;
  patientId: string;
  scheduledStart: string;
  scheduledEnd: string;
  notes: string | null;
  patientNote: string | null;
  cancelReason: string | null;
  cancellationReason: string | null;
  arrivedAt: string | null;
  checkedInAt: string | null;
  visitId: string | null;
  createdAt: string;
  paymentStatus: string;
  bookingFeeAmount: string;
  reminderSentAt: string | null;
  overriddenRule: string | null;
  overrideReason: string | null;
  patient: {
    id: string;
    name: string;
    phone: string | null;
    identifierType: string;
    identifierValue: string;
    // Phase 4 — the registration review reads what the record already holds;
    // the server has always sent the full patient row.
    dob: string | null;
    gender: string | null;
    address: string | null;
    // Final-UAT — the check-in drawer EDITS the record now, so the fields it
    // can edit are declared (the wire always carried them).
    race?: string | null;
    emergencyContactName?: string | null;
    emergencyContactPhone?: string | null;
  };
  staff: { id: string; fullName: string; calendarColor: string | null };
  service: { id: string; name: string; preInstructions: string | null; postInstructions: string | null };
  visit: { id: string; visitNumber: number; checkOutAt: string | null } | null;
  queueTicket: { id: string; displayNumber: string; status: string; queueType: string } | null;
  formAnswers: { id: string; label: string; answer: string | null }[];
  communications: {
    id: string;
    channel: string;
    template: string;
    status: string;
    sentAt: string | null;
  }[];
  events: AppointmentEventRow[];
  rescheduledFrom: { id: string; scheduledStart: string } | null;
  rescheduledTo: { id: string; scheduledStart: string; status: string } | null;
}

export function useAppointmentDetail(appointmentId: string | undefined) {
  return useQuery({
    queryKey: ['appointment-detail', appointmentId],
    queryFn: () => apiClient.get<AppointmentDetail>(`/appointments/${appointmentId}/detail`),
    enabled: Boolean(appointmentId),
  });
}

/** Records that a message was sent BY HAND — see the service's comment. */
export function useLogCommunication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      appointmentId,
      ...body
    }: {
      appointmentId: string;
      channel: string;
      template: string;
      destination?: string;
    }) => apiClient.post(`/appointment-communications/${appointmentId}`, body),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['appointment-detail', variables.appointmentId] });
      queryClient.invalidateQueries({ queryKey: ['appointment-dashboard'] });
    },
  });
}

export function useRejectAppointment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      apiClient.patch(`/appointments/${id}/reject`, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointment-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
    },
  });
}

// ---------------------------------------------------------------------------
// PHASE 7 — patient change requests, and the clinic's decision.
// ---------------------------------------------------------------------------

export interface AppointmentChangeRequestRow {
  id: string;
  type: 'RESCHEDULE' | 'CANCELLATION';
  status: 'PENDING' | 'APPROVED' | 'DECLINED' | 'SUPERSEDED';
  reason: string;
  requestedStart: string | null;
  requestedEnd: string | null;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export function useChangeRequests(appointmentId: string | undefined) {
  return useQuery({
    queryKey: ['appointment-change-requests', appointmentId],
    queryFn: () =>
      apiClient.get<AppointmentChangeRequestRow[]>(`/appointments/${appointmentId}/change-requests`),
    enabled: Boolean(appointmentId),
  });
}

/**
 * Approving goes through the canonical reschedule/cancel paths server-side;
 * a slot taken while the request waited surfaces here as the server's own
 * sentence and the request stays PENDING.
 */
export function useDecideChangeRequest(appointmentId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision, note }: { id: string; decision: 'approve' | 'decline'; note?: string }) =>
      apiClient.post<AppointmentChangeRequestRow[]>(
        `/appointment-change-requests/${id}/${decision}`,
        decision === 'decline' ? { note } : {},
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointment-change-requests', appointmentId] });
      queryClient.invalidateQueries({ queryKey: ['appointment-detail', appointmentId] });
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      queryClient.invalidateQueries({ queryKey: ['appointment-dashboard'] });
    },
  });
}
