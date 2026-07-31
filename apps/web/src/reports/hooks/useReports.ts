import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import { OutstandingClaimBatch } from '../../clinical/types';
import {
  AppointmentAnalytics,
  DayEndSummary,
  DoctorPerformance,
  DoctorPerformanceDetailed,
  InvoiceListingRow,
  PatientAnalysis,
  ProcedureAnalysis,
  ReportDateRangeParams,
  SalesAnalysis,
  SalesSummary,
} from '../types';

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

// ---- Report suite (D-039) ----

export function useDayEndSummary(date: string, clinicId?: string) {
  return useQuery({
    queryKey: ['reports-day-end', date, clinicId],
    queryFn: () =>
      apiClient.get<DayEndSummary>(`/reports/day-end?date=${date}${clinicId ? `&clinicId=${clinicId}` : ''}`),
    enabled: !!date,
  });
}

export function useSalesAnalysis(params: ReportDateRangeParams) {
  return useQuery({
    queryKey: ['reports-sales-analysis', params],
    queryFn: () => apiClient.get<SalesAnalysis>(`/reports/sales-analysis${toQueryString(params)}`),
  });
}

export function usePatientAnalysis(params: ReportDateRangeParams) {
  return useQuery({
    queryKey: ['reports-patient-analysis', params],
    queryFn: () => apiClient.get<PatientAnalysis>(`/reports/patient-analysis${toQueryString(params)}`),
  });
}

export function useProcedureAnalysis(params: ReportDateRangeParams) {
  return useQuery({
    queryKey: ['reports-procedure-analysis', params],
    queryFn: () => apiClient.get<ProcedureAnalysis>(`/reports/procedure-analysis${toQueryString(params)}`),
  });
}

export function useDoctorPerformanceDetailed(params: ReportDateRangeParams) {
  return useQuery({
    queryKey: ['reports-doctor-performance-detailed', params],
    queryFn: () => apiClient.get<DoctorPerformanceDetailed[]>(`/reports/doctor-performance-detailed${toQueryString(params)}`),
  });
}

export function useInvoiceListing(params: ReportDateRangeParams & { status?: string }) {
  return useQuery({
    queryKey: ['reports-invoices', params],
    queryFn: () =>
      apiClient.get<InvoiceListingRow[]>(
        `/reports/invoices${toQueryString(params)}${params.status ? `${params.from || params.to || params.clinicId ? '&' : '?'}status=${params.status}` : ''}`,
      ),
  });
}
