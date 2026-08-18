import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import { ItemPanelPrice } from '../types';

export function useItemPanelPricing(itemId: string | null) {
  return useQuery({
    queryKey: ['items', 'panel-pricing', itemId],
    queryFn: () => apiClient.get<ItemPanelPrice[]>(`/items/${itemId}/panel-pricing`),
    enabled: itemId !== null,
  });
}

/**
 * A saved price re-reads the whole table, not just the row.
 *
 * The EFFECTIVE price is derived server-side from the override, the panel's
 * markup and the item's cash price, so a row patched in the browser would be
 * the browser deciding what a patient is charged. Re-reading is the only
 * version of this that cannot drift from the invoice.
 */
export function useSetItemPanelPrice(itemId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ panelClinicId, overridePrice }: { panelClinicId: string; overridePrice: number | null }) =>
      apiClient.put(`/items/${itemId}/panel-pricing/${panelClinicId}`, { overridePrice }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['items', 'panel-pricing', itemId] }),
  });
}
