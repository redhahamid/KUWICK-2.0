import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import { CreateVisitDto, Visit } from '../types';

export function usePatientVisits(patientId?: string) {
  return useQuery({
    queryKey: ['visits', 'patient', patientId],
    queryFn: () => apiClient.get<Visit[]>(`/visits?patientId=${patientId}`),
    enabled: Boolean(patientId),
  });
}

export function useVisit(id?: string) {
  return useQuery({
    queryKey: ['visits', id],
    queryFn: () => apiClient.get<Visit>(`/visits/${id}`),
    enabled: Boolean(id),
  });
}

// D-044 — Patient Dashboard's "New Visit" entry point.
export function useCreateVisit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateVisitDto) => apiClient.post<Visit>('/visits', dto),
    onSuccess: (_, { patientId }) =>
      queryClient.invalidateQueries({ queryKey: ['visits', 'patient', patientId] }),
  });
}
