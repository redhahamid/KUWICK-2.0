import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import { Visit } from '../types';

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
