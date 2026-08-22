import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';

export type CalendarDisplayMode = 'STANDARD_HOURS' | 'TWENTY_FOUR_HOURS';

export interface ClinicBookingSettings {
  clinicId: string;
  firstSessionTime: string | null;
  lastSessionTime: string | null;
  minimumNoticeMinutes: number;
  maxAdvanceDays: number | null;
  observePublicHolidays: boolean;
  /**
   * Phase 3 — the diary axis, display only. STANDARD_HOURS draws the stated
   * hours plus padding; TWENTY_FOUR_HOURS draws 00:00→24:00. Never derived
   * from anybody's roster.
   */
  calendarDisplayMode: CalendarDisplayMode;
  displayOpenTime: string | null;
  displayCloseTime: string | null;
  displayPaddingMinutes: number;
  /** False when the clinic has never saved this screen and is on defaults. */
  configured: boolean;
}

export interface ClinicClosedDate {
  id: string;
  date: string;
  reason: string | null;
  createdBy: string | null;
  createdAt: string;
}

export function useBookingSettings(clinicId?: string) {
  return useQuery({
    queryKey: ['booking-settings', clinicId],
    queryFn: () => apiClient.get<ClinicBookingSettings>(`/clinics/${clinicId}/booking-settings`),
    enabled: Boolean(clinicId),
  });
}

export function useSaveBookingSettings(clinicId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    // Partial on purpose: the booking-window card and the calendar-display
    // card save independently, and the server merges what is absent.
    mutationFn: (dto: Partial<Omit<ClinicBookingSettings, 'clinicId' | 'configured'>> & {
      minimumNoticeMinutes: number;
    }) => apiClient.put<ClinicBookingSettings>(`/clinics/${clinicId}/booking-settings`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['booking-settings', clinicId] });
      // The engine's answers change with these, so anything holding slots is
      // now stale. Cheaper to drop them than to reason about which.
      queryClient.invalidateQueries({ queryKey: ['availability'] });
    },
  });
}

export function useClosedDates(clinicId?: string) {
  return useQuery({
    queryKey: ['closed-dates', clinicId],
    queryFn: () => apiClient.get<ClinicClosedDate[]>(`/clinics/${clinicId}/booking-settings/closed-dates`),
    enabled: Boolean(clinicId),
  });
}

export function useAddClosedDate(clinicId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: { date: string; reason?: string }) =>
      apiClient.post<ClinicClosedDate[]>(`/clinics/${clinicId}/booking-settings/closed-dates`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['closed-dates', clinicId] });
      queryClient.invalidateQueries({ queryKey: ['availability'] });
    },
  });
}

export function useRemoveClosedDate(clinicId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete<ClinicClosedDate[]>(`/clinics/${clinicId}/booking-settings/closed-dates/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['closed-dates', clinicId] });
      queryClient.invalidateQueries({ queryKey: ['availability'] });
    },
  });
}
