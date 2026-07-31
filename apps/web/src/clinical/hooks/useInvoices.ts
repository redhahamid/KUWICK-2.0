import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import { AddInvoiceLineDto, CancelInvoiceDto, CreateInvoiceDto, Invoice, PayInvoiceDto } from '../types';

export function useInvoices(visitId?: string) {
  return useQuery({
    queryKey: ['invoices', visitId],
    queryFn: () => apiClient.get<Invoice[]>(`/invoices?visitId=${visitId}`),
    enabled: Boolean(visitId),
  });
}

export function useCreateInvoice(visitId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateInvoiceDto) => apiClient.post<Invoice>('/invoices', dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invoices', visitId] }),
  });
}

export function useAddInvoiceLine(visitId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ invoiceId, dto }: { invoiceId: string; dto: AddInvoiceLineDto }) =>
      apiClient.post<Invoice>(`/invoices/${invoiceId}/lines`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invoices', visitId] }),
  });
}

export function useRemoveInvoiceLine(visitId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ invoiceId, lineId }: { invoiceId: string; lineId: string }) =>
      apiClient.delete<Invoice>(`/invoices/${invoiceId}/lines/${lineId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invoices', visitId] }),
  });
}

export function useCancelInvoice(visitId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ invoiceId, dto }: { invoiceId: string; dto: CancelInvoiceDto }) =>
      apiClient.patch<Invoice>(`/invoices/${invoiceId}/cancel`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invoices', visitId] }),
  });
}

// Dispensary payment step (Phase A6) — the last billing action before a
// visit can be completed.
export function usePayInvoice(visitId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ invoiceId, dto }: { invoiceId: string; dto: PayInvoiceDto }) =>
      apiClient.patch<Invoice>(`/invoices/${invoiceId}/pay`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invoices', visitId] }),
  });
}
