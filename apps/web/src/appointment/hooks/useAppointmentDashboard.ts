import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';

export type DashboardTab =
  | 'UPCOMING'
  | 'REQUESTS'
  | 'ARRIVED'
  | 'COMPLETED'
  | 'NO_SHOW'
  | 'CANCELLED'
  | 'TO_BE_SCHEDULED';

/** WAITLIST reads its own table and has no date range — see `useWaitlist`. */
export type ListTab = DashboardTab | 'WAITLIST';

export type PaymentState = 'NO_FEE' | 'UNPAID' | 'PAID';

export interface DashboardRow {
  id: string;
  status: string;
  source: string;
  clinicId: string;
  staffId: string;
  serviceId: string;
  patientId: string;
  scheduledStart: string;
  scheduledEnd: string;
  notes: string | null;
  patient: { id: string; name: string; phone: string | null };
  provider: { id: string; fullName: string };
  service: { id: string; name: string; price: string };
  sourceDetail: string | null;
  payment: { state: PaymentState; amount: number; paidAt: string | null };
  reminder: {
    sentAt: string | null;
    sentBy: string | null;
    lastChannel: string | null;
    lastStatus: string | null;
  };
}

export interface DashboardStats {
  upcoming: number;
  completed: number;
  cancelled: number;
  noShow: number;
  noShowRate: number | null;
  arrived: number;
  requests: number;
  /** §46 — what the diary is WORTH if it all happens. Not a sales forecast. */
  bookedValue: number;
  /** §46 — what the linked invoices actually came to. */
  realisedRevenue: number;
  timeZone: string;
}

export interface DashboardResponse {
  range: { from: string; to: string; timeZone: string };
  stats: DashboardStats;
  rows: DashboardRow[];
}

export interface DashboardFilter {
  clinicId?: string;
  from: string;
  to: string;
  tab: DashboardTab;
  staffId?: string;
  /** Phase 3H — multi-select; sent comma-joined, empty means every service. */
  serviceIds?: string[];
  /** Phase 3H — booking-source multi-select. */
  sources?: string[];
  search?: string;
}

function toQuery(filter: DashboardFilter): string {
  const search = new URLSearchParams();
  const { serviceIds, sources, ...scalar } = filter;
  for (const [key, value] of Object.entries(scalar)) {
    if (value) search.set(key, String(value));
  }
  if (serviceIds?.length) search.set('serviceId', serviceIds.join(','));
  if (sources?.length) search.set('source', sources.join(','));
  return search.toString();
}

export function useAppointmentDashboard(filter: DashboardFilter) {
  return useQuery({
    queryKey: ['appointment-dashboard', filter],
    queryFn: () => apiClient.get<DashboardResponse>(`/appointments/dashboard?${toQuery(filter)}`),
    enabled: Boolean(filter.clinicId),
    // The bar and the list come from one response, so they cannot show two
    // different periods mid-refresh.
    placeholderData: (previous) => previous,
  });
}

export function useMarkReminderSent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.post(`/appointments/${id}/reminder-sent`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['appointment-dashboard'] }),
  });
}
