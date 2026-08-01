import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import {
  NearExpiryBatch,
  QuickAddStockDto,
  SetStockMinThresholdDto,
  StockBatch,
  StockLevel,
  StockTakeDto,
  StockTakeResult,
} from '../types';

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

// Near-expiry report (D-043) — surfaces StockBatch.expiryDate, captured
// since the Task #62 quick-add/GRN flows but never reported on until now.
export function useNearExpiry(clinicId?: string, withinDays = 90) {
  return useQuery({
    queryKey: ['stock-near-expiry', clinicId, withinDays],
    queryFn: () =>
      apiClient.get<NearExpiryBatch[]>(
        `/stock/near-expiry${clinicQuery(clinicId)}${clinicId ? '&' : '?'}withinDays=${withinDays}`,
      ),
  });
}

// Stock take (D-043) — physical count vs system, reconciled via the same
// StockMovement ledger every other stock change goes through.
export function usePerformStockTake() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: StockTakeDto) => apiClient.post<StockTakeResult>('/stock/stock-take', dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock-levels'] });
      queryClient.invalidateQueries({ queryKey: ['stock-low-stock'] });
      queryClient.invalidateQueries({ queryKey: ['stock-negative-stock'] });
    },
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

// "Inventory In" quick modal (Task #62) — records incoming stock without a
// formal Purchase Order.
export function useQuickAddStock() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: QuickAddStockDto) => apiClient.post<StockBatch>('/stock/quick-add', dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock-levels'] });
      queryClient.invalidateQueries({ queryKey: ['stock-low-stock'] });
      queryClient.invalidateQueries({ queryKey: ['stock-negative-stock'] });
    },
  });
}
