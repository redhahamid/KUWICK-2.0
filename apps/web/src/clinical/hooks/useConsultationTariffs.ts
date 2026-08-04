import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import { ConsultationTariffRule, UpsertConsultationTariffRuleDto } from '../types';

// G4.5d3c-3b2 (D-094) — Clinic Settings → Consultation Tariffs.
const KEY = 'consultation-tariff-rules';

export function useConsultationTariffRules(clinicId?: string) {
  return useQuery({
    queryKey: [KEY, clinicId],
    queryFn: () =>
      apiClient.get<ConsultationTariffRule[]>(
        clinicId ? `/consultation-tariff-rules?clinicId=${clinicId}` : '/consultation-tariff-rules',
      ),
  });
}

export function useCreateConsultationTariffRule(clinicId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: UpsertConsultationTariffRuleDto) =>
      apiClient.post<ConsultationTariffRule>('/consultation-tariff-rules', dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY, clinicId] }),
  });
}

export function useUpdateConsultationTariffRule(clinicId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpsertConsultationTariffRuleDto }) =>
      apiClient.patch<ConsultationTariffRule>(`/consultation-tariff-rules/${id}`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY, clinicId] }),
  });
}

/** Deactivation, not deletion — the charges it produced keep their provenance. */
export function useDeactivateConsultationTariffRule(clinicId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<ConsultationTariffRule>(`/consultation-tariff-rules/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY, clinicId] }),
  });
}
