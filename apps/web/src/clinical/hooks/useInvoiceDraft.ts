import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import { ApplyDiscountDto, InvoiceDraft } from '../types';

/**
 * b4 PIECE B — the canvas bottom bar's read, and its one write.
 *
 * LIVE UPDATE IS AN INVALIDATION, NOT A SUBSCRIPTION. The draft is derived
 * server-side from the visit's sources on every read, so "editing a source
 * updates the draft" is satisfied by invalidating this key wherever a source
 * changes. `invalidateInvoiceDraft` is exported for exactly that, and the
 * medication, order and service hooks call it — one named function rather
 * than a string literal copied into four files, because a key that is right
 * in three of them and misspelt in the fourth is a bar that silently stops
 * agreeing with the rail.
 */
export const invoiceDraftKey = (visitId?: string) => ['invoice-draft', visitId] as const;

export function useInvoiceDraft(visitId?: string) {
  return useQuery({
    queryKey: invoiceDraftKey(visitId),
    queryFn: () => apiClient.get<InvoiceDraft>(`/visits/${visitId}/invoice-draft`),
    enabled: Boolean(visitId),
  });
}

export function useInvalidateInvoiceDraft(visitId?: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: invoiceDraftKey(visitId) });
}

/**
 * The invoice-level discount, from the bar.
 *
 * This is NOT a canvas-specific discount. The endpoint finds the visit's open
 * invoice and hands off to the same `InvoiceService.applyInvoiceDiscount` the
 * Billing Review screen calls, so the permission (`billing.corrections`), the
 * mandatory reason, the actor and the timestamp are the existing ones and the
 * discount is stored in exactly one place. Refusals — no open invoice yet, or
 * the staff member may not discount — come back as the server's own words.
 */
export function useApplyDraftDiscount(visitId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: ApplyDiscountDto) =>
      apiClient.patch<InvoiceDraft>(`/visits/${visitId}/invoice-draft/discount`, dto),
    onSuccess: () => {
      // A discount changes the invoice, so the billing readings move with it.
      queryClient.invalidateQueries({ queryKey: invoiceDraftKey(visitId) });
      queryClient.invalidateQueries({ queryKey: ['invoices', visitId] });
      queryClient.invalidateQueries({ queryKey: ['billing-worklist', visitId] });
    },
  });
}
