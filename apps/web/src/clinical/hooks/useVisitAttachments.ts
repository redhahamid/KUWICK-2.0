import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, downloadFile } from '../../core/api-client';
import { VisitAttachment, VoidClinicalRecordDto } from '../types';

// D-044 — free-standing visit-level uploads (photos, scanned results,
// PDFs) shown alongside Clinical Notes/Vitals.
export function useVisitAttachments(visitId?: string) {
  return useQuery({
    queryKey: ['visit-attachments', visitId],
    queryFn: () => apiClient.get<VisitAttachment[]>(`/visits/${visitId}/attachments`),
    enabled: Boolean(visitId),
  });
}

// G0 closure — the upload body carries the FILE and nothing else.
//
// C0 (D-051) moved uploader identity to the authenticated server session, and
// the controller stopped reading uploadedByStaffId from the request. The
// browser kept sending it anyway: harmless, because the server ignored it, but
// it left the code reading as though the client still chose who an image is
// attributed to. For an attribution field in a medicolegal record that is not
// a harmless inaccuracy — the next person to touch this should never think
// uploader identity is client-supplied.
//
// Exported so a test can assert what actually goes on the wire.
export function buildAttachmentFormData(file: File): FormData {
  const formData = new FormData();
  formData.append('file', file);
  return formData;
}

export function useUploadVisitAttachment(visitId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file }: { file: File }) =>
      apiClient.postFile<VisitAttachment>(`/visits/${visitId}/attachments`, buildAttachmentFormData(file)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['visit-attachments', visitId] }),
  });
}

// G3a (D-062) — replaces useDeleteVisitAttachment. A wound photo or scanned
// result is clinical evidence: removal takes it out of the active record but
// neither the row nor the stored file is destroyed.
export function useRemoveVisitAttachment(visitId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ attachmentId, ...dto }: VoidClinicalRecordDto & { attachmentId: string }) =>
      apiClient.patch<VisitAttachment>(`/visits/${visitId}/attachments/${attachmentId}/removal`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['visit-attachments', visitId] });
      queryClient.invalidateQueries({ queryKey: ['visit-attachment-history', visitId] });
    },
  });
}

export function useVisitAttachmentHistory(visitId?: string, enabled = false) {
  return useQuery({
    queryKey: ['visit-attachment-history', visitId],
    queryFn: () => apiClient.get<VisitAttachment[]>(`/visits/${visitId}/attachments/history`),
    enabled: Boolean(visitId) && enabled,
  });
}

export function downloadVisitAttachment(visitId: string, attachment: VisitAttachment): Promise<void> {
  return downloadFile(`/visits/${visitId}/attachments/${attachment.id}/download`, attachment.fileName);
}
