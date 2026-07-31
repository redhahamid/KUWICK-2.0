import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import { OutstandingClaimBatch } from '../../clinical/types';
import { AppointmentAnalytics, DoctorPerformance, ReportDateRangeParams, SalesSummary } from '../types';

function toQueryString(params: ReportDateRangeParams): string {
  const search = new URLSearchParams();
  if (params.from) search.set('from', params.from);
  if (params.to) search.set('to', params.to);
  if (params.clinicId) search.set('clinicId', params.clinicId);
  const query = search.toString();
  return query ? `?${query}` : '';
}

export function useSalesSummary(params: ReportDateRangeParams) {
  return useQuery({
    queryKey: ['reports-sales', params],
    queryFn: () => apiClient.get<SalesSummary>(`/reports/sales${toQueryString(params)}`),
  });
}

export function useAppointmentAnalytics(params: ReportDateRangeParams) {
  return useQuery({
    queryKey: ['reports-appointments', params],
    queryFn: () => apiClient.get<AppointmentAnalytics>(`/reports/appointments${toQueryString(params)}`),
  });
}

export function useDoctorPerformance(params: ReportDateRangeParams) {
  return useQuery({
    queryKey: ['reports-doctor-performance', params],
    queryFn: () => apiClient.get<DoctorPerformance[]>(`/reports/doctor-performance${toQueryString(params)}`),
  });
}

export function useReportsPanelAging() {
  return useQuery({
    queryKey: ['reports-panel-aging'],
    queryFn: () => apiClient.get<OutstandingClaimBatch[]>('/reports/panel-aging'),
  });
}
