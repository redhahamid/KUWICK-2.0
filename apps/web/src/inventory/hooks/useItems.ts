import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createResourceHooks } from '../../core/hooks/use-crud-resource';
import { apiClient } from '../../core/api-client';
import { Item, CreateItemDto, UpdateItemDto } from '../types';

export const { useList: useItems, useCreate: useCreateItem } = createResourceHooks<Item, CreateItemDto>(
  '/items',
  'items',
);

export function useUpdateItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateItemDto }) => apiClient.patch<Item>(`/items/${id}`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['items'] }),
  });
}
