import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import { ChatMessage } from '../types';

// D-046 — polling, not WebSocket (no realtime infra in this environment),
// same 10s convention as the Procedure Queue.
const CHAT_POLL_INTERVAL = 10_000;

export function useClinicChat(clinicId?: string) {
  return useQuery({
    queryKey: ['chat-messages', 'clinic', clinicId],
    queryFn: () => apiClient.get<ChatMessage[]>(`/clinics/${clinicId}/chat-messages`),
    enabled: Boolean(clinicId),
    refetchInterval: CHAT_POLL_INTERVAL,
  });
}

export function useSendClinicChat(clinicId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (message: string) => apiClient.post<ChatMessage>(`/clinics/${clinicId}/chat-messages`, { message }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['chat-messages', 'clinic', clinicId] }),
  });
}

export function useOrderChat(orderServiceId?: string) {
  return useQuery({
    queryKey: ['chat-messages', 'order', orderServiceId],
    queryFn: () => apiClient.get<ChatMessage[]>(`/order-services/${orderServiceId}/chat-messages`),
    enabled: Boolean(orderServiceId),
    refetchInterval: CHAT_POLL_INTERVAL,
  });
}

export function useSendOrderChat(orderServiceId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (message: string) => apiClient.post<ChatMessage>(`/order-services/${orderServiceId}/chat-messages`, { message }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['chat-messages', 'order', orderServiceId] }),
  });
}
