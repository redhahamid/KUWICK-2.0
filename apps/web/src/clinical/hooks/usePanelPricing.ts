import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import { CreatePanelExclusionDto, CreatePanelPriceOverrideDto, PanelExclusion, PanelPriceOverride } from '../types';

export function usePanelPriceOverrides(panelClinicId?: string) {
  return useQuery({
    queryKey: ['panel-price-overrides', panelClinicId],
    queryFn: () => apiClient.get<PanelPriceOverride[]>(`/panel-clinics/${panelClinicId}/price-overrides`),
    enabled: Boolean(panelClinicId),
  });
}

export function useCreatePanelPriceOverride(panelClinicId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreatePanelPriceOverrideDto) =>
      apiClient.post<PanelPriceOverride>(`/panel-clinics/${panelClinicId}/price-overrides`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['panel-price-overrides', panelClinicId] }),
  });
}

export function useDeletePanelPriceOverride(panelClinicId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/panel-clinics/${panelClinicId}/price-overrides/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['panel-price-overrides', panelClinicId] }),
  });
}

export function usePanelExclusions(panelClinicId?: string) {
  return useQuery({
    queryKey: ['panel-exclusions', panelClinicId],
    queryFn: () => apiClient.get<PanelExclusion[]>(`/panel-clinics/${panelClinicId}/exclusions`),
    enabled: Boolean(panelClinicId),
  });
}

export function useCreatePanelExclusion(panelClinicId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreatePanelExclusionDto) =>
      apiClient.post<PanelExclusion>(`/panel-clinics/${panelClinicId}/exclusions`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['panel-exclusions', panelClinicId] }),
  });
}

export function useDeletePanelExclusion(panelClinicId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/panel-clinics/${panelClinicId}/exclusions/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['panel-exclusions', panelClinicId] }),
  });
}
