import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../core/api-client';
import { ClinicalDocument, CreateDocumentDto, VoidClinicalRecordDto } from '../types';

export function useDocuments(visitId?: string) {
  return useQuery({
    queryKey: ['documents', visitId],
    queryFn: () => apiClient.get<ClinicalDocument[]>(`/documents?visitId=${visitId}`),
    enabled: Boolean(visitId),
  });
}

export function useCreateDocument(visitId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateDocumentDto) => apiClient.post<ClinicalDocument>('/documents', dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documents', visitId] }),
  });
}

// G3a (D-062) — replaces useDeleteDocument. An issued MC or referral leaves
// the clinic; deleting the row would erase the only record that it was ever
// issued. Voiding keeps the document and records who voided it and why.
export function useVoidDocument(visitId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...dto }: VoidClinicalRecordDto & { id: string }) =>
      apiClient.patch<ClinicalDocument>(`/documents/${id}/void`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents', visitId] });
      queryClient.invalidateQueries({ queryKey: ['document-history', visitId] });
    },
  });
}

// Every document ever issued for the visit, voided ones included, with the
// actor, time and reason of each void. Fetched only when the user asks.
export function useDocumentHistory(visitId?: string, enabled = false) {
  return useQuery({
    queryKey: ['document-history', visitId],
    queryFn: () => apiClient.get<ClinicalDocument[]>(`/documents/history?visitId=${visitId}`),
    enabled: Boolean(visitId) && enabled,
  });
}

// G3b closure (D-064) — clinical authorisation, or administrative issuance.
//
// G3b — no staffId on the wire. The browser used to send the visit's
// attending doctor whoever actually clicked; the signer is now the
// authenticated session, and sending an identity is a 400.
export function useAuthoriseDocument(visitId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, expectedVersion }: { id: string; expectedVersion?: number }) =>
      apiClient.patch<ClinicalDocument>(`/documents/${id}/authorise`, { expectedVersion }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents', visitId] });
      queryClient.invalidateQueries({ queryKey: ['document-history', visitId] });
    },
  });
}
