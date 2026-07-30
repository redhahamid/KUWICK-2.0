import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import { SetStockMinThresholdDto, StockLevel } from '../types';

function clinicQuery(clinicId?: string): string {
  return clinicId ? `?clinicId=${clinicId}` : '';
}

export function useStockLevels(clinicId?: string) {
  return useQuery({
    queryKey: ['stock-levels', clinicId],
    queryFn: () => apiClient.get<StockLevel[]>(`/stock/levels${clinicQuery(clinicId)}`),
  });
}

export function useLowStock(clinicId?: string) {
  return useQuery({
    queryKey: ['stock-low-stock', clinicId],
    queryFn: () => apiClient.get<StockLevel[]>(`/stock/low-stock${clinicQuery(clinicId)}`),
  });
}

export function useNegativeStock(clinicId?: string) {
  return useQuery({
    queryKey: ['stock-negative-stock', clinicId],
    queryFn: () => apiClient.get<StockLevel[]>(`/stock/negative-stock${clinicQuery(clinicId)}`),
  });
}

export function useSetStockMinThreshold() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: SetStockMinThresholdDto) => apiClient.post<StockLevel>('/stock/min-threshold', dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock-levels'] });
      queryClient.invalidateQueries({ queryKey: ['stock-low-stock'] });
    },
  });
}
