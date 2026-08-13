import { useMemo, useRef, useState } from 'react';
import { Alert, Button, Dropdown, Image, Progress, Tooltip, Typography, message } from 'antd';
import {
  CameraOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExperimentOutlined,
  FileTextOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  downloadVisitAttachment,
  useRemoveVisitAttachment,
  useSetAttachmentCategory,
  useUploadVisitAttachments,
  useVisitAttachments,
} from './hooks/useVisitAttachments';
import { useAttachmentBlobUrls } from './hooks/useAttachmentBlobUrls';
import { RemoveClinicalRecordModal } from './sections/RemoveClinicalRecordModal';
import {
  ATTACHMENT_ACCEPT,
  AttachmentCategory,
  UploadEntry,
  canRenderAsImage,
  categoryLabel,
  formatFileSize,
  summariseUploads,
} from './attachmentPresentation';
import { VisitAttachment } from './types';

const { Text } = Typography;

/**
 * b0 — THE visit's attachments. One component, one state, one region.
 *
 * It replaces two components that both rendered themselves: a summary strip
 * (`ClinicalImageStrip`) whose Upload button toggled a second, fuller panel
 * (`VisitAttachmentsPanel`) that ALSO carried a heading, the same thumbnails
 * and its own Upload. So on a visit with one file the doctor saw
 * "Attachments (1)" twice, the same photo twice, and a Hide button sitting on
 * top of the note area. Two components rendering the same list is not a
 * layout bug that can be styled away — the only fix is that there is one.
 *
 * The shape is the approved canvas (PDF p.2): a small ATTACHMENTS (N) label,
 * then one wrapping row of chips. Each chip states what KIND of file it is
 * (photo · lab · letter), its name, and the only two things anybody does with
 * it — view, remove. Upload sits at the end of the row and the whole region
 * takes a drag & drop.
 *
 * No thumbnails. The strip's 48px previews were what made the duplication
 * visually obvious, but they were also the reason the row could never be one
 * line: an image is looked at full size in the lightbox, and a chip gets a
 * doctor there in one click.
 */
interface VisitAttachmentsProps {
  visitId: string;
}

const CATEGORY_ICON: Record<AttachmentCategory, React.ReactNode> = {
  PHOTO: <CameraOutlined />,
  LAB: <ExperimentOutlined />,
  LETTER: <FileTextOutlined />,
};

const CATEGORIES: AttachmentCategory[] = ['PHOTO', 'LAB', 'LETTER'];

// Attribution travels with the file. Who photographed a wound and when is part
// of the clinical record, so it rides on the chip's title rather than being
// something only the removal dialog knows.
function attribution(attachment: VisitAttachment): string {
  const when = dayjs(attachment.createdAt).format('D MMM YYYY, HH:mm');
  return attachment.uploadedBy ? `${when} · ${attachment.uploadedBy.fullName}` : `${when} · Uploader not recorded`;
}

export function VisitAttachments({ visitId }: VisitAttachmentsProps) {
  const { data } = useVisitAttachments(visitId);
  const { upload, entries, uploading, clear } = useUploadVisitAttachments(visitId);
  const removeAttachment = useRemoveVisitAttachment(visitId);
  const setCategory = useSetAttachmentCategory(visitId);
  const [removing, setRemoving] = useState<VisitAttachment | null>(null);
  const [dragging, setDragging] = useState(false);
  // Which image the lightbox is open on, as an index into `images` — null when
  // it is closed. One piece of state for the whole region; the old pair of
  // components had two, which is how they disagreed about what was showing.
  const [previewAt, setPreviewAt] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // A removed file is retained and remains readable through its audited
  // history, but it must never appear here as part of the current record.
  const attachments = useMemo(
    () => (data ?? []).filter((file) => file.recordStatus === 'ACTIVE'),
    [data],
  );
  const blobUrls = useAttachmentBlobUrls(visitId, attachments);
  // The lightbox set is the files that can actually be rendered as pictures —
  // a PDF, and an image whose bytes did not load, both open by download
  // instead. Pointing the previewer at either shows a broken-image glyph,
  // which in a clinical record reads as "the file is gone".
  const images = attachments.filter((file) => canRenderAsImage(file, blobUrls[file.id]));

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const results = await upload(files);
    const summary = summariseUploads(results);
    if (summary.tone === 'success') message.success(summary.message);
    else if (summary.tone === 'warning') message.warning(summary.message);
    else message.error(summary.message);
    // A fully successful batch clears its own progress list. The chip IS the
    // confirmation, and leaving "ear-left.png · Uploaded" under a chip that
    // already says `ear-left.png` prints the filename twice — the same thing
    // the doctor reported about the heading. A batch with any failure keeps
    // its list, because the reason has to stay readable.
    if (summary.failed === 0) clear();
  };

  const view = (file: VisitAttachment) => {
    const index = images.findIndex((candidate) => candidate.id === file.id);
    if (index >= 0) {
      setPreviewAt(index);
      return;
    }
    void downloadVisitAttachment(visitId, file);
  };

  const refile = async (file: VisitAttachment, category: AttachmentCategory) => {
    if (category === file.category) return;
    try {
      await setCategory.mutateAsync({ attachmentId: file.id, category, expectedVersion: file.version });
      message.success(`Filed as ${categoryLabel(category)}`);
    } catch {
      message.error('The file could not be re-filed');
    }
  };

  return (
    <section
      className={`kw-attachments${dragging ? ' kw-attachments-dragging' : ''}`}
      // The count the test asserts against. Exactly one element carries it on
      // any screen, at any width, with any number of files attached.
      data-attachments-region="visit"
      aria-label="Attachments"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void handleFiles(Array.from(event.dataTransfer?.files ?? []));
      }}
    >
      <div className="kw-attachments-label">Attachments ({attachments.length})</div>

      <div className="kw-attachments-row">
        {attachments.map((file) => (
          <div
            key={file.id}
            className="kw-attachment-chip"
            data-attachment-category={file.category}
            title={`${file.fileName} — ${formatFileSize(file.fileSize)} · ${attribution(file)}`}
          >
            {/* The kind is a CONTROL, not decoration: a referral arrives as a
                photographed page as often as a PDF, so whoever files it has
                to be able to say so. Changing it is recorded server-side. */}
            <Dropdown
              trigger={['click']}
              menu={{
                selectable: true,
                selectedKeys: [file.category],
                items: CATEGORIES.map((category) => ({
                  key: category,
                  icon: CATEGORY_ICON[category],
                  label: categoryLabel(category),
                  onClick: () => void refile(file, category),
                })),
              }}
            >
              <Tooltip title={`Filed as ${categoryLabel(file.category)} — click to change`}>
                <button type="button" className="kw-attachment-kind" aria-label={`Filed as ${categoryLabel(file.category)}`}>
                  {CATEGORY_ICON[file.category]}
                </button>
              </Tooltip>
            </Dropdown>

            <div className="kw-attachment-body">
              <span className="kw-attachment-name">{file.fileName}</span>
              <span className="kw-attachment-actions">
                <button type="button" className="kw-attachment-action" onClick={() => view(file)}>
                  view
                </button>
                <span aria-hidden>·</span>
                {/* Removal is audited and reason-bearing (G3a/D-062), so the
                    × opens the shared confirmation, never a bare Popconfirm. */}
                <button
                  type="button"
                  className="kw-attachment-action"
                  aria-label={`Remove ${file.fileName}`}
                  onClick={() => setRemoving(file)}
                >
                  ×
                </button>
              </span>
            </div>
          </div>
        ))}

        <div className="kw-attachments-upload">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ATTACHMENT_ACCEPT}
            aria-label="Choose files to attach to this visit"
            style={{ display: 'none' }}
            onChange={(event) => {
              void handleFiles(Array.from(event.target.files ?? []));
              event.target.value = '';
            }}
          />
          <Button
            size="small"
            icon={<UploadOutlined />}
            loading={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            Upload
          </Button>
          <Text type="secondary" style={{ fontSize: 12 }}>
            or drag &amp; drop
          </Text>
        </div>
      </div>

      {/* Per-file progress and outcome. One failure never cancels the
          successes, so the batch reports each file separately and the ones
          that failed say why in visible text. */}
      {entries.length > 0 && (
        <div className="kw-upload-progress" role="status" aria-live="polite">
          {entries.map((entry: UploadEntry) => (
            <div key={entry.key} className="kw-upload-progress-row">
              <Text style={{ fontSize: 12, flex: '1 1 auto', minWidth: 0 }} ellipsis title={entry.fileName}>
                {entry.fileName}
              </Text>
              <Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                {formatFileSize(entry.size)}
              </Text>
              {entry.state === 'QUEUED' && (
                <Text type="secondary" style={{ fontSize: 11 }}>
                  Waiting
                </Text>
              )}
              {entry.state === 'UPLOADING' && (
                <Progress percent={100} status="active" showInfo={false} size="small" style={{ width: 70 }} />
              )}
              {entry.state === 'DONE' && (
                <Text type="success" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                  <CheckCircleOutlined aria-hidden /> Uploaded
                </Text>
              )}
              {entry.state === 'FAILED' && (
                // The REASON is visible text, not a tooltip: a rejected
                // clinical file needs an answer the doctor can act on, and a
                // tooltip is unreachable on a touch screen. The attribute
                // rides on a plain span — Typography.Text does not forward
                // unknown props to the DOM node.
                <span data-upload-error={entry.fileName}>
                  <Text type="danger" style={{ fontSize: 11 }}>
                    <CloseCircleOutlined aria-hidden /> {entry.error ?? 'Failed'}
                  </Text>
                </span>
              )}
            </div>
          ))}
          {!uploading && entries.some((entry) => entry.state === 'FAILED') && (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 6 }}
              message="Some files were not uploaded"
              description="The files marked Uploaded are on the record and do not need to be sent again. Retry only the failed ones."
              action={
                <Button size="small" onClick={clear}>
                  Dismiss
                </Button>
              }
            />
          )}
        </div>
      )}

      {/* The lightbox, driven by the region's one piece of preview state.
          `items` rather than wrapped <Image> children: the chips are not
          thumbnails, so there is nothing on the page for a PreviewGroup to
          register — and next/prev across the visit's photos still works. */}
      <Image.PreviewGroup
        items={images.map((file) => blobUrls[file.id]).filter(Boolean)}
        preview={{
          open: previewAt !== null,
          current: previewAt ?? 0,
          onOpenChange: (open) => {
            if (!open) setPreviewAt(null);
          },
        }}
      />

      <RemoveClinicalRecordModal
        open={Boolean(removing)}
        title="Remove file from visit"
        okText="Confirm removal"
        retentionMessage="This file will be removed from the active visit record. The file itself and its audit history are preserved and remain retrievable."
        placeholder="e.g. Photo taken on the wrong patient; uploaded to the wrong visit"
        details={[
          { label: 'File', value: removing?.fileName },
          { label: 'Filed as', value: removing ? categoryLabel(removing.category) : null },
          { label: 'Type', value: removing?.mimeType },
          { label: 'Uploaded', value: removing ? attribution(removing) : null },
        ]}
        pending={removeAttachment.isPending}
        successMessage="File removed from the visit — the original is preserved"
        errorMessage="Failed to remove the file"
        onConfirm={(reason) =>
          removeAttachment.mutateAsync({
            attachmentId: removing!.id,
            reason,
            expectedVersion: removing!.version,
          })
        }
        onClose={() => setRemoving(null)}
      />
    </section>
  );
}
