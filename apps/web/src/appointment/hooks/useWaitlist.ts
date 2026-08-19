import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';

export interface WaitlistRow {
  id: string;
  patient: { id: string; name: string; phone: string | null };
  service: { id: string; name: string };
  preferredProvider: { id: string; fullName: string } | null;
  earliestDate: string | null;
  latestDate: string | null;
  preferredDaypart: string | null;
  priority: number;
  note: string | null;
  status: string;
  offeredAt: string | null;
  createdAt: string;
}

export function useWaitlist(params: {
  clinicId?: string;
  staffId?: string;
  serviceId?: string;
  search?: string;
}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, String(value));
  }
  return useQuery({
    queryKey: ['waitlist', params],
    queryFn: () =>
      apiClient.get<WaitlistRow[]>(`/appointments/dashboard/waitlist?${query.toString()}`),
    enabled: Boolean(params.clinicId),
    placeholderData: (previous) => previous,
  });
}

export function useAddToWaitlist() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post('/waitlist', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['waitlist'] }),
  });
}

export function useUpdateWaitlistEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
      apiClient.patch(`/waitlist/${id}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['waitlist'] }),
  });
}
