import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import { CreateLeaveRequestDto, DecideLeaveRequestDto, LeaveRequest, LeaveStatus } from '../types';

/**
 * An options object rather than three positional arguments, so a caller that
 * wants only the BRANCH does not have to pass two `undefined`s to reach it —
 * and so it reads like `useEmployees` and `useStaffClaims`, which take the
 * same branch the same way.
 *
 * Leaving `clinicId` out means "the branches this account manages", which is
 * what the screens that are not branch-filtered want; the server decides that,
 * not this hook.
 */
export function useLeaveRequests(params: { staffId?: string; status?: LeaveStatus; clinicId?: string } = {}) {
  const search = new URLSearchParams();
  if (params.staffId) search.set('staffId', params.staffId);
  if (params.status) search.set('status', params.status);
  if (params.clinicId) search.set('clinicId', params.clinicId);
  const query = search.toString();
  return useQuery({
    queryKey: ['leave-requests', params],
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
