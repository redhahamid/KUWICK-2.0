import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';

export interface ClinicBookingSettings {
  clinicId: string;
  firstSessionTime: string;
  lastSessionTime: string;
  minimumNoticeMinutes: number;
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
    mutationFn: (dto: Omit<ClinicBookingSettings, 'clinicId' | 'configured'>) =>
      apiClient.put<ClinicBookingSettings>(`/clinics/${clinicId}/booking-settings`, dto),
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
