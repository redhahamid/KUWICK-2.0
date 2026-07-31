import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import { CreateLeaveRequestDto, DecideLeaveRequestDto, LeaveRequest, LeaveStatus } from '../types';

export function useLeaveRequests(staffId?: string, status?: LeaveStatus) {
  const search = new URLSearchParams();
  if (staffId) search.set('staffId', staffId);
  if (status) search.set('status', status);
  const query = search.toString();
  return useQuery({
    queryKey: ['leave-requests', staffId, status],
    queryFn: () => apiClient.get<LeaveRequest[]>(`/leave-requests${query ? `?${query}` : ''}`),
  });
}

export function useCreateLeaveRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateLeaveRequestDto) => apiClient.post<LeaveRequest>('/leave-requests', dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leave-requests'] }),
  });
}

export function useApproveLeaveRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: DecideLeaveRequestDto }) =>
      apiClient.patch<LeaveRequest>(`/leave-requests/${id}/approve`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leave-requests'] }),
  });
}

export function useRejectLeaveRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: DecideLeaveRequestDto }) =>
      apiClient.patch<LeaveRequest>(`/leave-requests/${id}/reject`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leave-requests'] }),
  });
}
