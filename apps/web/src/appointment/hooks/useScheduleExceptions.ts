import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import { ScheduleException } from '../types';

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

export interface ScheduleExceptionFilter {
  [key: string]: string | undefined;
  clinicId?: string;
  staffId?: string;
  from?: string;
  to?: string;
}

export function useScheduleExceptions(filter: ScheduleExceptionFilter = {}) {
  return useQuery({
    queryKey: ['schedule-exceptions', filter],
    queryFn: () => apiClient.get<ScheduleException[]>(`/schedule-exceptions${toQueryString(filter)}`),
  });
}
