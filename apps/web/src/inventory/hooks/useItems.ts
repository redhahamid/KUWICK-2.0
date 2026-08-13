import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createResourceHooks } from '../../core/hooks/use-crud-resource';
import { apiClient } from '../../core/api-client';
import { Item, CreateItemDto, UpdateItemDto } from '../types';

export const { useList: useItems, useCreate: useCreateItem } = createResourceHooks<Item, CreateItemDto>(
  '/items',
  'items',
);

/**
 * PHASE 1G — the inventory list, searchable.
 *
 * The catalogue is 236 medicines and the page shows ten at a time, so the
 * screen that now edits a medicine's standard prescription could not reach one
 * without clicking through twenty-four pages. That is the same "seeded is not
 * findable" defect as the diagnosis and medicine search outages, one screen
 * over: the rows were all there, and no one could get to them.
 *
 * The server does the searching — it already matches name, code and the
 * clinic's own Malay group tag (`itemSearchClauses`), and a browser cannot
 * filter a list it was never sent. The term is part of the QUERY KEY so each
 * search is its own cache entry rather than overwriting the full list.
 */
export function useItemSearch(search: string) {
  const term = search.trim();
  return useQuery({
    queryKey: ['items', 'search', term],
    queryFn: () =>
      apiClient.get<Item[]>(
        // No term means the management list, unbounded and unchanged: this page
        // legitimately lists the whole catalogue, and silently truncating it to
        // twenty would be a worse defect than the one being fixed.
        term ? `/items?search=${encodeURIComponent(term)}&take=100` : '/items',
      ),
  });
}

export function useUpdateItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateItemDto }) => apiClient.patch<Item>(`/items/${id}`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['items'] }),
  });
}
