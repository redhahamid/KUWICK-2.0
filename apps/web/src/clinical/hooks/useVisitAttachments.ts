import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiClient, downloadFile } from '../../core/api-client';
import { VisitAttachment, VoidClinicalRecordDto } from '../types';
import { AttachmentCategory, UploadEntry, buildUploadQueue } from '../attachmentPresentation';

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

/**
 * G4.5d3c-3c — uploading a SET of files.
 *
 * The panel previously took `e.target.files?.[0]` from an input with no
 * `multiple` attribute: selecting four scanned pages uploaded one and dropped
 * three, silently. This hook uploads every file that was chosen, and reports
 * each one's outcome separately.
 *
 * Two properties the owner asked for specifically, and both are structural
 * rather than incidental:
 *
 *   ONE FAILURE DOES NOT CANCEL THE SUCCESSES. Each file is its own request
 *   with its own try/catch. A rejected file — too large, wrong type, a
 *   momentary network fault — marks itself FAILED and the loop continues. It
 *   is not `Promise.all`, which would leave the caller unable to say WHICH
 *   file failed, and it is not a bulk endpoint, which would make the whole
 *   batch one transaction and lose the good files with the bad.
 *
 *   FILES ALREADY UPLOADED STAY UPLOADED. The query is invalidated once per
 *   successful file, so the list fills in as the batch progresses; a failure
 *   afterwards cannot roll any of them back.
 *
 * Sequential rather than parallel, deliberately: uploads are multi-megabyte
 * photos from a clinic's shared connection, and six at once makes all six
 * slow and any of them likelier to time out.
 */
export function useUploadVisitAttachments(visitId?: string) {
  const queryClient = useQueryClient();
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const [uploading, setUploading] = useState(false);

  const update = useCallback((key: string, patch: Partial<UploadEntry>) => {
    setEntries((current) => current.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)));
  }, []);

  const upload = useCallback(
    async (files: File[]): Promise<UploadEntry[]> => {
      if (!visitId || files.length === 0) return [];
      const queue = buildUploadQueue(files);
      setEntries(queue);
      setUploading(true);

      const results: UploadEntry[] = [];
      for (let index = 0; index < files.length; index += 1) {
        const entry = queue[index];
        update(entry.key, { state: 'UPLOADING' });
        try {
          await apiClient.postFile<VisitAttachment>(
            `/visits/${visitId}/attachments`,
            buildAttachmentFormData(files[index]),
          );
          // Invalidated per file: what has landed is visible immediately, and
          // a later failure cannot un-land it.
          await queryClient.invalidateQueries({ queryKey: ['visit-attachments', visitId] });
          update(entry.key, { state: 'DONE' });
          results.push({ ...entry, state: 'DONE' });
        } catch (error) {
          const reason = error instanceof ApiError ? error.message : 'Upload failed';
          update(entry.key, { state: 'FAILED', error: reason });
          results.push({ ...entry, state: 'FAILED', error: reason });
        }
      }

      setUploading(false);
      return results;
    },
    [visitId, queryClient, update],
  );

  const clear = useCallback(() => setEntries([]), []);

  return { upload, entries, uploading, clear };
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

/**
 * b0 — re-file an attachment as photo | lab | letter.
 *
 * `expectedVersion` is sent for the same reason removal sends it: two people
 * looking at the same visit is normal in a clinic, and the second one's click
 * must not silently overwrite a decision made a moment earlier.
 */
export function useSetAttachmentCategory(visitId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ attachmentId, ...dto }: { attachmentId: string; category: AttachmentCategory; expectedVersion?: number }) =>
      apiClient.patch<VisitAttachment>(`/visits/${visitId}/attachments/${attachmentId}/category`, dto),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['visit-attachments', visitId] }),
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
