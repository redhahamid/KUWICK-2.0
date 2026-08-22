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
      // Visit queries EMBED a copy of the patient, and surfaces read it from
      // there (the canvas allergy strip reads visit.patient.allergies). A
      // demographics change that leaves those copies stale is the same
      // defect family as the billing worklist: the screen keeps saying
      // something the server no longer does. Demographics edits are rare, so
      // the whole namespace is refetched rather than guessing which visits
      // carry this patient.
      queryClient.invalidateQueries({ queryKey: ['visits'] });
      // The check-in drawer edits demographics in place (final-UAT); the
      // appointment detail embeds its own patient copy, so it is stale the
      // moment the save lands.
      queryClient.invalidateQueries({ queryKey: ['appointment-detail'] });
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
