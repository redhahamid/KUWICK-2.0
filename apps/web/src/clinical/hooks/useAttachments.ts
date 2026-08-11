import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, downloadFile } from '../../core/api-client';
import { Attachment, VoidClinicalRecordDto } from '../types';

export function useAttachments(orderServiceId?: string) {
  return useQuery({
    queryKey: ['attachments', orderServiceId],
    queryFn: () => apiClient.get<Attachment[]>(`/order-services/${orderServiceId}/attachments`),
    enabled: Boolean(orderServiceId),
  });
}

export function useUploadAttachment(orderServiceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return apiClient.postFile<Attachment>(`/order-services/${orderServiceId}/attachments`, formData);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['attachments', orderServiceId] }),
  });
}

// G3a (D-062) — replaces useDeleteAttachment. A lab report or ECG trace is
// the evidence behind a completed procedure; removal is audited and the file
// stays retrievable from the order's history.
export function useRemoveAttachment(orderServiceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ attachmentId, ...dto }: VoidClinicalRecordDto & { attachmentId: string }) =>
      apiClient.patch<Attachment>(`/order-services/${orderServiceId}/attachments/${attachmentId}/removal`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attachments', orderServiceId] });
      queryClient.invalidateQueries({ queryKey: ['attachment-history', orderServiceId] });
    },
  });
}

export function useAttachmentHistory(orderServiceId: string, enabled = false) {
  return useQuery({
    queryKey: ['attachment-history', orderServiceId],
    queryFn: () => apiClient.get<Attachment[]>(`/order-services/${orderServiceId}/attachments/history`),
    enabled: Boolean(orderServiceId) && enabled,
  });
}

export function downloadAttachment(orderServiceId: string, attachment: Attachment): Promise<void> {
  return downloadFile(`/order-services/${orderServiceId}/attachments/${attachment.id}/download`, attachment.fileName);
}
