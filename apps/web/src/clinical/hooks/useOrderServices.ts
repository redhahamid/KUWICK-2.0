import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import { invoiceDraftKey } from './useInvoiceDraft';
import {
  CancelOrderServiceDto,
  CompleteOrderServiceDto,
  CreateOrderServiceDto,
  OrderService,
  OrderServiceStatus,
  ServiceOrderType,
} from '../types';

export interface OrderServiceFilter {
  [key: string]: string | undefined;
  orderType?: ServiceOrderType;
  status?: OrderServiceStatus;
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

export function useOrderServices(visitId?: string, filter: OrderServiceFilter = {}) {
  return useQuery({
    queryKey: ['order-services', visitId, filter],
    queryFn: () => apiClient.get<OrderService[]>(`/order-services${toQueryString({ visitId, ...filter })}`),
    enabled: Boolean(visitId),
  });
}

// Single order, with visit/patient/clinic/requestedBy joined — backs the
// print-result view.
export function useOrderService(id?: string) {
  return useQuery({
    queryKey: ['order-service', id],
    queryFn: () => apiClient.get<OrderService>(`/order-services/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateOrderService(visitId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateOrderServiceDto) => apiClient.post<OrderService>('/order-services', dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-services', visitId] });
      // b4 PIECE B — orders, procedures and direct services are three of the
      // bottom bar's four sources; adding, completing or cancelling one moves
      // the running total.
      queryClient.invalidateQueries({ queryKey: invoiceDraftKey(visitId) });
    },
  });
}

function useOrderServiceAction(visitId: string | undefined, action: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input?: CompleteOrderServiceDto | CancelOrderServiceDto }) =>
      apiClient.patch<OrderService>(`/order-services/${id}/${action}`, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-services', visitId] });
      // b4 PIECE B — orders, procedures and direct services are three of the
      // bottom bar's four sources; adding, completing or cancelling one moves
      // the running total.
      queryClient.invalidateQueries({ queryKey: invoiceDraftKey(visitId) });
    },
  });
}

export const useStartOrderService = (visitId?: string) => useOrderServiceAction(visitId, 'start');
export const useCompleteOrderService = (visitId?: string) => useOrderServiceAction(visitId, 'complete');
export const useCancelOrderService = (visitId?: string) => useOrderServiceAction(visitId, 'cancel');
