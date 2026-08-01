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

export function useUploadVisitAttachment(visitId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, uploadedByStaffId }: { file: File; uploadedByStaffId?: string }) => {
      const formData = new FormData();
      formData.append('file', file);
      if (uploadedByStaffId) formData.append('uploadedByStaffId', uploadedByStaffId);
      return apiClient.postFile<VisitAttachment>(`/visits/${visitId}/attachments`, formData);
    },
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
