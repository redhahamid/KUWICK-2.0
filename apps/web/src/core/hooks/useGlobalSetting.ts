import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api-client';

export function useGlobalSetting<T>(key: string) {
  return useQuery({
    queryKey: ['global-settings', key],
    queryFn: () => apiClient.get<T | null>(`/global-settings/${key}`),
  });
}

export function useSetGlobalSetting<T>(key: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (value: T) => apiClient.put<T>(`/global-settings/${key}`, { value }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['global-settings', key] }),
  });
}
