import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import { CatalogueResponse, ItemCategory } from '../types';

export interface CatalogueFilters {
  search: string;
  category?: string;
  attentionOnly: boolean;
  activeOnly: boolean;
  clinicId?: string;
}

/**
 * The management list. Every filter is part of the QUERY KEY and part of the
 * REQUEST: the server owns which rows match, including the attention rule,
 * which is `divisorFacts` and must stay the only implementation of it.
 */
export function useItemCatalogue(filters: CatalogueFilters) {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set('search', filters.search.trim());
  if (filters.category) params.set('category', filters.category);
  if (filters.attentionOnly) params.set('attentionOnly', 'true');
  if (filters.activeOnly) params.set('activeOnly', 'true');
  if (filters.clinicId) params.set('clinicId', filters.clinicId);
  const query = params.toString();

  return useQuery({
    queryKey: ['items', 'catalogue', filters],
    queryFn: () => apiClient.get<CatalogueResponse>(`/items/catalogue${query ? `?${query}` : ''}`),
  });
}

export function useItemCategories() {
  return useQuery({
    queryKey: ['item-categories'],
    queryFn: () => apiClient.get<ItemCategory[]>('/item-categories'),
  });
}

/**
 * Every category write invalidates the ITEMS too, not just the category list.
 *
 * A rename moves the string on every item that carried it. A list that
 * refreshed its tabs and not its rows would show the new name above rows still
 * labelled with the old one, which reads as the rename having half worked —
 * and it is precisely the failure the server's transaction exists to prevent,
 * so the screen must not reintroduce it.
 */
function useCategoryMutation<TVariables>(fn: (variables: TVariables) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['item-categories'] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
    },
  });
}

export const useCreateCategory = () =>
  useCategoryMutation((name: string) => apiClient.post('/item-categories', { name }));

export const useAdoptCategory = () =>
  useCategoryMutation((name: string) => apiClient.post('/item-categories/adopt', { name }));

export const useRenameCategory = () =>
  useCategoryMutation(({ id, name }: { id: string; name: string }) =>
    apiClient.patch(`/item-categories/${id}`, { name }),
  );

export const useDeleteCategory = () =>
  useCategoryMutation((id: string) => apiClient.delete(`/item-categories/${id}`));

/**
 * The quick +/-. ADJUSTMENT, with a reason, never a goods receipt — see
 * `AdjustStockDto`.
 */
export function useAdjustStock() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: { clinicId: string; itemId: string; quantityDelta: number; reason: string }) =>
      apiClient.post('/stock/adjust', dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['stock'] });
    },
  });
}
