import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import { CreateItemAgeDosageDto, ItemAgeDosage } from '../types';

export function useItemAgeDosages(itemId?: string) {
  return useQuery({
    queryKey: ['item-age-dosages', itemId],
    queryFn: () => apiClient.get<ItemAgeDosage[]>(`/item-age-dosages?itemId=${itemId}`),
    enabled: Boolean(itemId),
  });
}

export function useCreateItemAgeDosage(itemId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateItemAgeDosageDto) => apiClient.post<ItemAgeDosage>('/item-age-dosages', dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['item-age-dosages', itemId] }),
  });
}

export function useRemoveItemAgeDosage(itemId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/item-age-dosages/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['item-age-dosages', itemId] }),
  });
}
