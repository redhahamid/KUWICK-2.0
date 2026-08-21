import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';

export interface BookingPage {
  id: string;
  clinicId: string;
  slug: string;
  displayName: string;
  logoUrl: string | null;
  language: string;
  introText: string | null;
  requirePhone: boolean;
  requireEmail: boolean;
  requireNric: boolean;
  showReasonField: boolean;
  active: boolean;
  allowPatientReschedule: boolean;
  allowPatientCancel: boolean;
  patientChangeCutoffHours: number;
  confirmationMessage: string | null;
}

export interface BookingPageResponse {
  page: BookingPage | null;
  reminderRules: { id: string; offsetMinutes: number; channel: string }[];
  links: {
    general: string;
    /** Every public bookable service; `path` is null until it has a link ending. */
    services: { serviceId: string; name: string; path: string | null }[];
  } | null;
}

export function useBookingPage(clinicId: string | undefined) {
  return useQuery({
    queryKey: ['booking-page', clinicId],
    queryFn: () => apiClient.get<BookingPageResponse>(`/booking-page?clinicId=${clinicId}`),
    enabled: Boolean(clinicId),
  });
}

export function useSaveBookingPage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiClient.put<BookingPageResponse>('/booking-page', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['booking-page'] }),
  });
}

export function useSaveReminderRules() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { clinicId: string; offsets: number[]; channel?: string; serviceId?: string }) =>
      apiClient.put<BookingPageResponse>('/booking-page/reminder-rules', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['booking-page'] }),
  });
}
