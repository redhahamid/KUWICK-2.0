import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import type { CounterPrefill, PanelEmployer } from '../types';

/**
 * THE EMPLOYERS BEHIND A PANEL, AND WHAT THE COUNTER ALREADY KNOWS (N-5).
 *
 * Both read from the panel module's endpoints rather than from a clinical one:
 * an employer is panel configuration, and the counter is only borrowing it.
 */
export function usePanelEmployers(panelClinicId?: string) {
  return useQuery({
    queryKey: ['panel-employers', panelClinicId],
    queryFn: () =>
      apiClient.get<PanelEmployer[]>(`/panel-workspace/panels/${panelClinicId}/employers`),
    // No panel, no employers to ask for — and asking would 404.
    enabled: Boolean(panelClinicId),
  });
}

export function useCreatePanelEmployer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ panelClinicId, name }: { panelClinicId: string; name: string }) =>
      apiClient.post<PanelEmployer>(`/panel-workspace/panels/${panelClinicId}/employers`, { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['panel-employers'] }),
  });
}

/**
 * The panel, employer, card number and relationship this patient last came in
 * on, and whether the clinic wants them pre-selected.
 *
 * A SUGGESTION, NEVER A COMMITMENT: the visit still starts unverified and staff
 * still press Verify. See `PanelCounterService`.
 */
export function useCounterPrefill(patientId?: string) {
  return useQuery({
    queryKey: ['panel-counter-prefill', patientId],
    queryFn: () => apiClient.get<CounterPrefill>(`/panel-workspace/counter-prefill/${patientId}`),
    enabled: Boolean(patientId),
    // The counter re-opens on the same patient often; a stale pre-fill would
    // only ever be stale by one visit, and that visit is the one being created.
    staleTime: 0,
  });
}
