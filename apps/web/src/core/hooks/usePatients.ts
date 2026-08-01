import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createResourceHooks } from './use-crud-resource';
import { apiClient } from '../api-client';
import { Patient, CreatePatientDto, UpdatePatientDto } from '../types';

export const { useList: usePatients, useCreate: useCreatePatient } = createResourceHooks<
  Patient,
  CreatePatientDto
>('/patients', 'patients');

// "Enter patient name, NRIC or phone number" — the combined search field on
// the Add Appointment wizard's Patient step and the front-desk Patients
// list search box.
export function usePatientSearch(search: string) {
  return useQuery({
    queryKey: ['patients', 'search', search],
    queryFn: () => apiClient.get<Patient[]>(`/patients?search=${encodeURIComponent(search)}`),
    enabled: search.length > 0,
  });
}

export function usePatient(id?: string) {
  return useQuery({
    queryKey: ['patients', id],
    queryFn: () => apiClient.get<Patient>(`/patients/${id}`),
    enabled: Boolean(id),
  });
}

export function useUpdatePatient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdatePatientDto }) =>
      apiClient.patch<Patient>(`/patients/${id}`, dto),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['patients'] });
      queryClient.invalidateQueries({ queryKey: ['patients', id] });
    },
  });
}

// Soft-deletes (Patient.deletedAt) — visits/invoices/documents keep
// referencing the record, it just drops off the active Patients list.
export function useDeletePatient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<Patient>(`/patients/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['patients'] }),
  });
}
