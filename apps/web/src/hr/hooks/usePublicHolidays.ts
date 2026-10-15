import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createResourceHooks } from '../../core/hooks/use-crud-resource';
import { apiClient } from '../../core/api-client';
import { CreatePublicHolidayDto, PublicHoliday, UpdatePublicHolidayDto } from '../types';

export const { useList: usePublicHolidays, useCreate: useCreatePublicHoliday } = createResourceHooks<
  PublicHoliday,
  CreatePublicHolidayDto
>('/public-holidays', 'public-holidays');

export function useUpdatePublicHoliday() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdatePublicHolidayDto & { id: string }) => apiClient.patch<PublicHoliday>(`/public-holidays/${id}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['public-holidays'] }),
  });
}

export function useDeletePublicHoliday() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/public-holidays/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['public-holidays'] }),
  });
}

export interface HolidayPresets {
  year: number;
  state: string;
  /** False when Kuwick has no list for that year yet. */
  available: boolean;
  holidays: { date: string; name: string; check: boolean; onCalendar: boolean }[];
}

/** The year's federal and state holidays for one state, to tick before loading. */
export function useHolidayPresets(year: number, state: string | null) {
  return useQuery({
    queryKey: ['public-holidays', 'presets', year, state],
    queryFn: () => apiClient.get<HolidayPresets>(`/public-holidays/presets?year=${year}&state=${encodeURIComponent(state ?? '')}`),
    enabled: Boolean(state),
  });
}

export function useLoadHolidayPresets() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { year: number; state: string; dates: string[] }) => apiClient.post<{ added: number; skipped: number }>('/public-holidays/presets', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['public-holidays'] }),
  });
}
