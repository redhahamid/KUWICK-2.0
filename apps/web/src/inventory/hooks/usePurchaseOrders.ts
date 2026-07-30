import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PurchaseOrderStatus } from '@kuwick/shared';
import { apiClient } from '../../core/api-client';
import { CreatePurchaseOrderDto, GoodsReceivedNote, PurchaseOrder, ReceivePurchaseOrderDto } from '../types';

export interface PurchaseOrderFilter {
  [key: string]: string | undefined;
  clinicId?: string;
  status?: PurchaseOrderStatus;
}

function toQueryString(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      search.set(key, value);
    }
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

export function usePurchaseOrders(filter: PurchaseOrderFilter = {}) {
  return useQuery({
    queryKey: ['purchase-orders', filter],
    queryFn: () => apiClient.get<PurchaseOrder[]>(`/purchase-orders${toQueryString(filter)}`),
  });
}

export function useCreatePurchaseOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreatePurchaseOrderDto) => apiClient.post<PurchaseOrder>('/purchase-orders', dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['procurement-requests'] });
    },
  });
}

export function useReceivePurchaseOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: ReceivePurchaseOrderDto }) =>
      apiClient.post<GoodsReceivedNote>(`/purchase-orders/${id}/receive`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['stock-levels'] });
      queryClient.invalidateQueries({ queryKey: ['stock-low-stock'] });
      queryClient.invalidateQueries({ queryKey: ['stock-negative-stock'] });
    },
  });
}
