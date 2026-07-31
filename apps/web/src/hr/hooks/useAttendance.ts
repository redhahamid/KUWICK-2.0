import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import { AttendanceRecord } from '../types';

export interface AttendanceParams {
  from?: string;
  to?: string;
  clinicId?: string;
  staffId?: string;
}

export function useAttendance(params: AttendanceParams) {
  const search = new URLSearchParams();
  if (params.from) search.set('from', params.from);
  if (params.to) search.set('to', params.to);
  if (params.clinicId) search.set('clinicId', params.clinicId);
  if (params.staffId) search.set('staffId', params.staffId);
  const query = search.toString();
  return useQuery({
    queryKey: ['attendance', params],
    queryFn: () => apiClient.get<AttendanceRecord[]>(`/attendance${query ? `?${query}` : ''}`),
  });
}
