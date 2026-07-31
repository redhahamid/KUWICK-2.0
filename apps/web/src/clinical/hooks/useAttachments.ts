import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, downloadFile } from '../../core/api-client';
import { Attachment } from '../types';

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

export function useDeleteAttachment(orderServiceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (attachmentId: string) =>
      apiClient.delete(`/order-services/${orderServiceId}/attachments/${attachmentId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['attachments', orderServiceId] }),
  });
}

export function downloadAttachment(orderServiceId: string, attachment: Attachment): Promise<void> {
  return downloadFile(`/order-services/${orderServiceId}/attachments/${attachment.id}/download`, attachment.fileName);
}
