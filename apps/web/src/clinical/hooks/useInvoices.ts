import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import {
  AddInvoiceLineDto,
  ApplyDiscountDto,
  BillingWorklistItem,
  CancelInvoiceDto,
  CancelInvoiceLineDto,
  CreateInvoiceDto,
  Invoice,
  OverridePanelBenefitDto,
  PayInvoiceDto,
  RecordPanelVerificationDto,
  Visit,
  VisitClassification,
  VisitCompletionBlocker,
} from '../types';

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

// ---------------------------------------------------------------------------
// G4.5d3c-3b2 (D-094) — Counter Billing Review.
//
// Every mutation below invalidates the whole billing view together: the
// invoice, the worklist and the completion blockers are three readings of one
// state, and a screen showing two of them refreshed and one stale would be
// telling the counter something untrue.
// ---------------------------------------------------------------------------
function useBillingRefresh(visitId?: string) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['invoices', visitId] });
    queryClient.invalidateQueries({ queryKey: ['billing-worklist', visitId] });
    queryClient.invalidateQueries({ queryKey: ['completion-blockers', visitId] });
    queryClient.invalidateQueries({ queryKey: ['visit', visitId] });
  };
}

export function useBillingWorklist(visitId?: string) {
  return useQuery({
    queryKey: ['billing-worklist', visitId],
    queryFn: () => apiClient.get<BillingWorklistItem[]>(`/visits/${visitId}/billing-worklist`),
    enabled: Boolean(visitId),
  });
}

export function useCompletionBlockers(visitId?: string) {
  return useQuery({
    queryKey: ['completion-blockers', visitId],
    queryFn: () => apiClient.get<VisitCompletionBlocker[]>(`/visits/${visitId}/completion-blockers`),
    enabled: Boolean(visitId),
  });
}

/** Idempotent consultation auto-add — safe to call on every open. */
export function useEnsureConsultation(visitId?: string) {
  const refresh = useBillingRefresh(visitId);
  return useMutation({
    mutationFn: (invoiceId: string) =>
      apiClient.post<{ added: boolean; state: { kind: string; reason?: string } }>(
        `/invoices/${invoiceId}/ensure-consultation`,
        {},
      ),
    onSuccess: (result) => {
      // Only disturb the view when something actually changed.
      if (result?.added) refresh();
    },
  });
}

/** The explicit counter add: an exempt visit, or a deliberate re-add. */
export function useAddConsultationCharge(visitId?: string) {
  const refresh = useBillingRefresh(visitId);
  return useMutation({
    mutationFn: (invoiceId: string) => apiClient.post<Invoice>(`/invoices/${invoiceId}/consultation-charge`, {}),
    onSuccess: refresh,
  });
}

export function useCancelInvoiceLine(visitId?: string) {
  const refresh = useBillingRefresh(visitId);
  return useMutation({
    mutationFn: ({ invoiceId, lineId, dto }: { invoiceId: string; lineId: string; dto: CancelInvoiceLineDto }) =>
      apiClient.delete<Invoice>(`/invoices/${invoiceId}/lines/${lineId}`, dto),
    onSuccess: refresh,
  });
}

export function useApplyLineDiscount(visitId?: string) {
  const refresh = useBillingRefresh(visitId);
  return useMutation({
    mutationFn: ({ invoiceId, lineId, dto }: { invoiceId: string; lineId: string; dto: ApplyDiscountDto }) =>
      apiClient.patch<Invoice>(`/invoices/${invoiceId}/lines/${lineId}/discount`, dto),
    onSuccess: refresh,
  });
}

export function useApplyInvoiceDiscount(visitId?: string) {
  const refresh = useBillingRefresh(visitId);
  return useMutation({
    mutationFn: ({ invoiceId, dto }: { invoiceId: string; dto: ApplyDiscountDto }) =>
      apiClient.patch<Invoice>(`/invoices/${invoiceId}/discount`, dto),
    onSuccess: refresh,
  });
}

export function useRecordPanelVerification(visitId?: string) {
  const refresh = useBillingRefresh(visitId);
  return useMutation({
    mutationFn: (dto: RecordPanelVerificationDto) => apiClient.patch<Visit>(`/visits/${visitId}/panel-verification`, dto),
    onSuccess: refresh,
  });
}

export function useOverridePanelBenefit(visitId?: string) {
  const refresh = useBillingRefresh(visitId);
  return useMutation({
    mutationFn: (dto: OverridePanelBenefitDto) =>
      apiClient.patch<Visit>(`/visits/${visitId}/panel-benefit-override`, dto),
    onSuccess: refresh,
  });
}

export function useSetVisitClassification(visitId?: string) {
  const refresh = useBillingRefresh(visitId);
  return useMutation({
    mutationFn: (classification: VisitClassification) =>
      apiClient.patch<Visit>(`/visits/${visitId}/classification`, { classification }),
    onSuccess: refresh,
  });
}

/** Billing-wide refresh after a payment: invoice, worklist and blockers. */
export function useSettleInvoice(visitId?: string) {
  const refresh = useBillingRefresh(visitId);
  return useMutation({
    mutationFn: ({ invoiceId, dto }: { invoiceId: string; dto: PayInvoiceDto }) =>
      apiClient.patch<Invoice>(`/invoices/${invoiceId}/pay`, dto),
    onSuccess: refresh,
  });
}
