/**
 * G4.5d3c-3c — how attached files are described, and how a batch upload
 * reports itself.
 *
 * Pure. No React, no network, no antd. The upload panel renders these
 * decisions; it does not make them.
 */

export type AttachmentKind = 'IMAGE' | 'PDF' | 'OTHER';

export interface AttachmentLike {
  fileName?: string | null;
  mimeType?: string | null;
}

/**
 * What KIND of thing this attachment is, decided from the MIME type the
 * server stored and falling back to the file extension.
 *
 * The fallback matters: an upload that arrives with `application/octet-stream`
 * — which is what several scanner and phone-share paths send for a PDF — was
 * previously classified as "not an image" and nothing else, so it rendered as
 * a bare count with no icon, no name and nothing to click. Reading the
 * extension is a guess, but it is a guess about presentation only; nothing
 * clinical, financial or security-related branches on it.
 */
export function attachmentKind(attachment: AttachmentLike): AttachmentKind {
  const mime = (attachment.mimeType ?? '').toLowerCase();
  if (mime.startsWith('image/')) return 'IMAGE';
  if (mime === 'application/pdf') return 'PDF';

  const name = (attachment.fileName ?? '').toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp|heic|heif)$/.test(name)) return 'IMAGE';
  if (/\.pdf$/.test(name)) return 'PDF';
  return 'OTHER';
}

/**
 * Whether this attachment may be rendered as a picture.
 *
 * TWO conditions, both required. A PDF is never an image however it is
 * labelled — pointing an <img> at PDF bytes produces a broken-image icon
 * inside a clinical record, which reads as "the file is missing" rather than
 * "this is a document". And an image whose bytes could not be fetched has no
 * object URL, so it is shown as a file row too: a blank grey square invites
 * the reader to assume there is nothing there.
 */
export function canRenderAsImage(attachment: AttachmentLike, blobUrl: string | undefined): boolean {
  return attachmentKind(attachment) === 'IMAGE' && Boolean(blobUrl);
}

/** Human-readable size. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Batch upload
// ---------------------------------------------------------------------------

export type UploadState = 'QUEUED' | 'UPLOADING' | 'DONE' | 'FAILED';

export interface UploadEntry {
  /** Stable within one batch; file names are not unique. */
  key: string;
  fileName: string;
  size: number;
  state: UploadState;
  /** Present only when state is FAILED. */
  error?: string;
}

export function buildUploadQueue(files: File[]): UploadEntry[] {
  return files.map((file, index) => ({
    key: `${index}-${file.name}-${file.size}`,
    fileName: file.name,
    size: file.size,
    state: 'QUEUED' as const,
  }));
}

/**
 * What the clinic is told after a batch finishes.
 *
 * The rule the owner asked for is that ONE failure must not cancel the
 * successes, and this is where that becomes visible: a mixed batch reports
 * both numbers, and the files that did upload are stated as uploaded. A batch
 * summarised only by its failure teaches staff to re-upload everything, which
 * is how duplicates of a wound photo end up on a record.
 */
export interface UploadSummary {
  succeeded: number;
  failed: number;
  tone: 'success' | 'warning' | 'error';
  message: string;
}

export function summariseUploads(entries: UploadEntry[]): UploadSummary {
  const succeeded = entries.filter((entry) => entry.state === 'DONE').length;
  const failed = entries.filter((entry) => entry.state === 'FAILED').length;

  if (failed === 0) {
    return {
      succeeded,
      failed,
      tone: 'success',
      message: succeeded === 1 ? '1 file uploaded' : `${succeeded} files uploaded`,
    };
  }
  if (succeeded === 0) {
    return {
      succeeded,
      failed,
      tone: 'error',
      message: failed === 1 ? '1 file could not be uploaded' : `${failed} files could not be uploaded`,
    };
  }
  return {
    succeeded,
    failed,
    tone: 'warning',
    message: `${succeeded} of ${succeeded + failed} files uploaded — ${failed} failed`,
  };
}

/**
 * What the file picker offers.
 *
 * Images and PDFs together, in one selection. The previous input carried the
 * same `accept` string but no `multiple`, so a doctor who selected four
 * scanned pages got one — and the other three were silently discarded by the
 * browser, with no error anywhere to notice.
 *
 * G4.5d3c-3c1 — narrowed from `image/*` to the four types the SERVER accepts,
 * so the picker stops offering files that will be refused on arrival. This is
 * a convenience, not a control: `accept` is a filter on a dialog and a direct
 * caller never opens one. The enforcement is `attachment-validation.ts`, which
 * checks the declared type, the extension AND the file's leading bytes.
 */
export const ATTACHMENT_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

/** The wording the server returns for a refused type, mirrored for clarity. */
export const UNSUPPORTED_FILE_MESSAGE = 'Unsupported file type. Upload JPG, PNG, WebP or PDF.';
