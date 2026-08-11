import { useRef } from 'react';
import { Alert, Button, Card, Image, List, Progress, Space, Tag, Tooltip, Typography, message } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  DownloadOutlined,
  FileOutlined,
  FilePdfOutlined,
  PaperClipOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useState } from 'react';
import dayjs from 'dayjs';
import {
  downloadVisitAttachment,
  useRemoveVisitAttachment,
  useUploadVisitAttachments,
  useVisitAttachments,
} from './hooks/useVisitAttachments';
import { useAttachmentBlobUrls } from './hooks/useAttachmentBlobUrls';
import { RemoveClinicalRecordModal } from './sections/RemoveClinicalRecordModal';
import {
  ATTACHMENT_ACCEPT,
  UploadEntry,
  attachmentKind,
  canRenderAsImage,
  formatFileSize,
  summariseUploads,
} from './attachmentPresentation';
import { VisitAttachment } from './types';

const { Text } = Typography;

// G0 closure — two deliberate sizes. The compact strip sits beside the note
// and must not push it around, so it stays small and recognisable. The
// expanded panel is where a doctor actually looks at a wound or a lesion, so
// it is large enough to judge without opening anything — but still a preview,
// not a full-resolution image dumped into the page. Full resolution is one
// click away in the lightbox.
const COMPACT_THUMB = 48;
const EXPANDED_THUMB = 96;

// Attribution travels with the image, in the lightbox as well as the list —
// who took a wound photo is part of the clinical record, not list decoration.
function attribution(attachment: VisitAttachment): string {
  const when = dayjs(attachment.createdAt).format('D MMM YYYY, HH:mm');
  return attachment.uploadedBy ? `${when} · ${attachment.uploadedBy.fullName}` : `${when} · Uploader not recorded`;
}

interface VisitAttachmentsPanelProps {
  visitId: string;
  compact?: boolean;
}

// D-044 — images/PDFs/results attached to the visit itself, not tied to a
// specific order/procedure.
// G0b (D-055) — clinical images are now previewed inline and in a lightbox
// gallery instead of having to be downloaded and opened outside the record.
export function VisitAttachmentsPanel({ visitId, compact }: VisitAttachmentsPanelProps) {
  const { data: attachments, isLoading } = useVisitAttachments(visitId);
  const { upload, entries, uploading, clear } = useUploadVisitAttachments(visitId);
  const removeAttachment = useRemoveVisitAttachment(visitId);
  const [removing, setRemoving] = useState<VisitAttachment | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const blobUrls = useAttachmentBlobUrls(visitId, attachments);

  // G4.5d3c-3c — every chosen file, not just the first. No uploader id is
  // sent for any of them: the server derives it from the session (C0).
  const handleFilesChosen = async (files: FileList | null) => {
    const chosen = Array.from(files ?? []);
    if (chosen.length === 0) return;
    const results = await upload(chosen);
    const summary = summariseUploads(results);
    if (summary.tone === 'success') message.success(summary.message);
    else if (summary.tone === 'warning') message.warning(summary.message);
    else message.error(summary.message);
  };

  // G3a (D-062) — removal is audited and reason-bearing, so it opens the
  // shared confirmation rather than a one-line Popconfirm.
  const removalModal = (
    <RemoveClinicalRecordModal
      open={Boolean(removing)}
      title="Remove file from visit"
      okText="Confirm removal"
      retentionMessage="This file will be removed from the active visit record. The file itself and its audit history are preserved and remain retrievable."
      placeholder="e.g. Photo taken on the wrong patient; uploaded to the wrong visit"
      details={[
        { label: 'File', value: removing?.fileName },
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
  );

  const hiddenInput = (
    <input
      ref={fileInputRef}
      type="file"
      // G4.5d3c-3c — `multiple`. Images and PDFs may be selected together in
      // one pass; the accept list has always allowed both, but without this
      // attribute the browser handed over exactly one file and discarded the
      // rest with no error to notice.
      multiple
      accept={ATTACHMENT_ACCEPT}
      aria-label="Choose files to attach to this visit"
      style={{ display: 'none' }}
      onChange={(e) => {
        void handleFilesChosen(e.target.files);
        e.target.value = '';
      }}
    />
  );

  // Per-file progress and result. Rendered wherever the panel is, so a batch
  // is never a spinner that ends in one word: each file says what happened to
  // it, and the ones that failed say why.
  const progressPanel = entries.length > 0 && (
    <div className="kw-upload-progress" role="status" aria-live="polite" style={{ width: '100%' }}>
      {entries.map((entry: UploadEntry) => (
        <div key={entry.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <Text
            style={{ fontSize: 12, flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
            title={entry.fileName}
          >
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
            // G4.5d3c-3c1 — the REASON is visible text, not a tooltip. A
            // rejected clinical file needs an answer the doctor can act on
            // ("Upload JPG, PNG, WebP or PDF"), and a tooltip is unreachable
            // on a touch screen and invisible to anyone scanning the list.
            // The attribute rides on a plain span: antd's Typography.Text
            // does not forward unknown props to the DOM node.
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
  );

  const all = attachments ?? [];
  const count = all.length;
  // A PDF is NEVER rendered as a picture, and neither is an image whose bytes
  // could not be fetched: pointing an <img> at either produces a broken-image
  // icon, which in a clinical record reads as "the file is missing" rather
  // than "this is a document". Both fall through to a file card.
  const images = all.filter((a) => canRenderAsImage(a, blobUrls[a.id]));
  const others = all.filter((a) => !images.includes(a));

  // C2 — nothing attached: a single row, not a card wrapped around an
  // empty-list placeholder.
  if (compact && count === 0) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '2px 10px',
          border: '1px solid #f0f0f0',
          borderRadius: 6,
          marginBottom: 4,
        }}
      >
        <Text type="secondary" style={{ fontSize: 12 }}>
          <PaperClipOutlined /> Attachments (0)
        </Text>
        {hiddenInput}
        <Button
          size="small"
          type="text"
          icon={<UploadOutlined />}
          loading={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          Upload
        </Button>
        {progressPanel}
      </div>
    );
  }

  // Compact with content: a thumbnail strip. Clicking any thumbnail opens the
  // lightbox on that image and can page through the rest of the set.
  if (compact) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 10px',
          border: '1px solid #f0f0f0',
          borderRadius: 6,
          marginBottom: 4,
          flexWrap: 'wrap',
        }}
      >
        <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
          <PaperClipOutlined /> Attachments ({count})
        </Text>

        {/* PreviewGroup registers its children through context. Wrapping each
            Image in a Tooltip broke that registration — the lightbox opened
            with a single image and no next/prev — so attribution rides on the
            native title attribute instead of an antd Tooltip. */}
        <Image.PreviewGroup>
          <Space size={4} wrap>
            {images.map((attachment) => (
              <Image
                key={attachment.id}
                src={blobUrls[attachment.id]}
                alt={attachment.fileName}
                title={`${attachment.fileName} — ${attribution(attachment)}`}
                // G0 closure — 48px in the compact strip: big enough to tell
                // an otoscope view from a wound photo at a glance, small
                // enough that the strip stays one line beside the note.
                width={COMPACT_THUMB}
                height={COMPACT_THUMB}
                style={{ objectFit: 'cover', borderRadius: 4, cursor: 'zoom-in' }}
              />
            ))}
          </Space>
        </Image.PreviewGroup>

        {/* A PDF gets a CARD: its icon, its name and one click to open it.
            Everything non-image lands here rather than in the image row. */}
        {others.map((attachment) => (
          <Tooltip key={attachment.id} title={`${attachment.fileName} — ${attribution(attachment)}`}>
            <Button
              size="small"
              type="text"
              data-attachment-kind={attachmentKind(attachment)}
              icon={attachmentKind(attachment) === 'PDF' ? <FilePdfOutlined /> : <FileOutlined />}
              onClick={() => downloadVisitAttachment(visitId, attachment)}
            >
              <span style={{ maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block', verticalAlign: 'bottom' }}>
                {attachment.fileName}
              </span>
            </Button>
          </Tooltip>
        ))}

        {hiddenInput}
        <Button
          size="small"
          type="text"
          icon={<UploadOutlined />}
          loading={uploading}
          onClick={() => fileInputRef.current?.click()}
          style={{ marginLeft: 'auto' }}
        >
          Upload
        </Button>
        {progressPanel}
      </div>
    );
  }

  return (
    <Card
      size="small"
      title={
        <Space>
          <PaperClipOutlined /> Attachments
          {count > 0 && <Tag>{count}</Tag>}
        </Space>
      }
      style={{ marginBottom: 8 }}
      styles={{ header: { padding: '4px 12px', minHeight: 32 }, body: { padding: '8px 12px' } }}
      extra={
        <>
          {hiddenInput}
          <Button
            size="small"
            icon={<UploadOutlined />}
            loading={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            Upload
          </Button>
        </>
      }
    >
      <Image.PreviewGroup>
        <List
          size="small"
          loading={isLoading}
          dataSource={all}
          locale={{ emptyText: 'No files attached yet' }}
          renderItem={(attachment: VisitAttachment) => {
            const url = blobUrls[attachment.id];
            const kind = attachmentKind(attachment);
            // A PDF must never take the <Image> branch, even when a blob URL
            // happens to exist for it: an <img> pointed at PDF bytes renders
            // the browser's broken-image glyph.
            const asImage = canRenderAsImage(attachment, url);
            return (
              <List.Item
                data-attachment-kind={kind}
                actions={[
                  <Button
                    key="download"
                    size="small"
                    type="text"
                    icon={<DownloadOutlined />}
                    onClick={() => downloadVisitAttachment(visitId, attachment)}
                  />,
                  <Tooltip key="remove" title="Remove from visit (audited)">
                    <Button
                      size="small"
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => setRemoving(attachment)}
                    />
                  </Tooltip>,
                ]}
              >
                <List.Item.Meta
                  avatar={
                    asImage ? (
                      <Image
                        src={url}
                        alt={attachment.fileName}
                        title={`${attachment.fileName} — ${attribution(attachment)}`}
                        width={EXPANDED_THUMB}
                        height={EXPANDED_THUMB}
                        style={{ objectFit: 'cover', borderRadius: 4, cursor: 'zoom-in' }}
                      />
                    ) : (
                      // The file card. A PDF is a document, and it says so —
                      // an icon, its type in words, and a download action
                      // beside it. Never a grey square that reads as a
                      // picture that failed to load.
                      <span
                        aria-label={kind === 'PDF' ? 'PDF document' : 'File'}
                        style={{
                          display: 'inline-flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 2,
                          width: EXPANDED_THUMB,
                          height: EXPANDED_THUMB,
                          borderRadius: 4,
                          border: '1px solid #f0f0f0',
                          background: '#fafafa',
                          fontSize: 20,
                          color: kind === 'PDF' ? '#cf1322' : undefined,
                        }}
                      >
                        {kind === 'PDF' ? <FilePdfOutlined /> : <FileOutlined />}
                        <Text type="secondary" style={{ fontSize: 10 }}>
                          {kind === 'PDF' ? 'PDF' : 'File'}
                        </Text>
                      </span>
                    )
                  }
                  title={<Text style={{ fontSize: 13 }}>{attachment.fileName}</Text>}
                  description={
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {formatFileSize(attachment.fileSize)} · {attribution(attachment)}
                    </Text>
                  }
                />
              </List.Item>
            );
          }}
        />
      </Image.PreviewGroup>
      {progressPanel}
      {removalModal}
    </Card>
  );
}
