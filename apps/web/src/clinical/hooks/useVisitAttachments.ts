import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, downloadFile } from '../../core/api-client';
import { VisitAttachment } from '../types';

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

export function useDeleteVisitAttachment(visitId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (attachmentId: string) => apiClient.delete(`/visits/${visitId}/attachments/${attachmentId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['visit-attachments', visitId] }),
  });
}

export function downloadVisitAttachment(visitId: string, attachment: VisitAttachment): Promise<void> {
  return downloadFile(`/visits/${visitId}/attachments/${attachment.id}/download`, attachment.fileName);
}
