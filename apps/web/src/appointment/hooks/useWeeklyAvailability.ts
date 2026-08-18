import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';

export interface WeeklyDay {
  id?: string;
  dayOfWeek: number;
  /** "HH:MM", the clinic's wall clock. */
  startTime: string;
  endTime: string;
}

export function useWeeklyAvailability(staffId?: string, clinicId?: string) {
  return useQuery({
    queryKey: ['weekly-availability', staffId, clinicId],
    queryFn: () =>
      apiClient.get<WeeklyDay[]>(
        `/doctor-schedules/weekly?staffId=${staffId}&clinicId=${clinicId}`,
      ),
    enabled: Boolean(staffId && clinicId),
  });
}

export function useSaveWeeklyAvailability() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: { staffId: string; clinicId: string; days: WeeklyDay[] }) =>
      apiClient.put<WeeklyDay[]>('/doctor-schedules/weekly', dto),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['weekly-availability', variables.staffId, variables.clinicId],
      });
      queryClient.invalidateQueries({ queryKey: ['doctor-schedules'] });
      queryClient.invalidateQueries({ queryKey: ['availability'] });
    },
  });
}
