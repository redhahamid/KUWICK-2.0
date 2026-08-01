import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import { ChatChannel, ChatMessage } from '../types';

// D-046/D-048 — polling, not WebSocket (no realtime infra in this
// environment), same 10s convention as the Procedure Queue.
const CHAT_POLL_INTERVAL = 10_000;

// Channel list also carries each channel's latest-message marker, which is
// what the notification bell polls to compute the unread badge without
// fetching every channel's full message history.
export function useChatChannels(clinicId?: string) {
  return useQuery({
    queryKey: ['chat-channels', clinicId],
    queryFn: () => apiClient.get<ChatChannel[]>(`/clinics/${clinicId}/chat-channels`),
    enabled: Boolean(clinicId),
    refetchInterval: CHAT_POLL_INTERVAL,
  });
}

export function useCreateChatChannel(clinicId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => apiClient.post<ChatChannel>(`/clinics/${clinicId}/chat-channels`, { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['chat-channels', clinicId] }),
  });
}

export function useChannelChat(channelId?: string) {
  return useQuery({
    queryKey: ['chat-messages', 'channel', channelId],
    queryFn: () => apiClient.get<ChatMessage[]>(`/chat-channels/${channelId}/messages`),
    enabled: Boolean(channelId),
    refetchInterval: CHAT_POLL_INTERVAL,
  });
}

export function useSendChannelChat(channelId?: string, clinicId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (message: string) => apiClient.post<ChatMessage>(`/chat-channels/${channelId}/messages`, { message }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chat-messages', 'channel', channelId] });
      queryClient.invalidateQueries({ queryKey: ['chat-channels', clinicId] });
    },
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
