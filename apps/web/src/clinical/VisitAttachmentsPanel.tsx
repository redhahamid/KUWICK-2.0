import { useRef, useState } from 'react';
import { Button, Card, Image, List, Space, Tag, Tooltip, Typography, message } from 'antd';
import {
  DeleteOutlined,
  DownloadOutlined,
  FileOutlined,
  FilePdfOutlined,
  PaperClipOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  downloadVisitAttachment,
  useRemoveVisitAttachment,
  useUploadVisitAttachment,
  useVisitAttachments,
} from './hooks/useVisitAttachments';
import { useAttachmentBlobUrls } from './hooks/useAttachmentBlobUrls';
import { RemoveClinicalRecordModal } from './sections/RemoveClinicalRecordModal';
import { ApiError } from '../core/api-client';
import { VisitAttachment } from './types';

const { Text } = Typography;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImage(attachment: VisitAttachment): boolean {
  return Boolean(attachment.mimeType?.startsWith('image/'));
}

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
  const uploadAttachment = useUploadVisitAttachment(visitId);
  const removeAttachment = useRemoveVisitAttachment(visitId);
  const [removing, setRemoving] = useState<VisitAttachment | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const blobUrls = useAttachmentBlobUrls(visitId, attachments);

  const handleFileChosen = async (file: File | undefined) => {
    if (!file) return;
    try {
      // No uploader id is sent — the server derives it from the session (C0).
      await uploadAttachment.mutateAsync({ file });
      message.success('File uploaded');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to upload file');
    }
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
      accept="image/*,application/pdf"
      style={{ display: 'none' }}
      onChange={(e) => {
        void handleFileChosen(e.target.files?.[0]);
        e.target.value = '';
      }}
    />
  );

  const all = attachments ?? [];
  const count = all.length;
  // An image whose bytes could not be fetched is shown as a file row rather
  // than a broken thumbnail — a blank square in a clinical record invites the
  // reader to assume there is nothing there.
  const images = all.filter((a) => isImage(a) && blobUrls[a.id]);
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
          loading={uploadAttachment.isPending}
          onClick={() => fileInputRef.current?.click()}
        >
          Upload
        </Button>
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

        {others.map((attachment) => (
          <Tooltip key={attachment.id} title={`${attachment.fileName} — ${attribution(attachment)}`}>
            <Button
              size="small"
              type="text"
              icon={attachment.mimeType === 'application/pdf' ? <FilePdfOutlined /> : <FileOutlined />}
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
          loading={uploadAttachment.isPending}
          onClick={() => fileInputRef.current?.click()}
          style={{ marginLeft: 'auto' }}
        >
          Upload
        </Button>
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
            loading={uploadAttachment.isPending}
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
            return (
              <List.Item
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
                    url ? (
                      <Image
                        src={url}
                        alt={attachment.fileName}
                        title={`${attachment.fileName} — ${attribution(attachment)}`}
                        width={EXPANDED_THUMB}
                        height={EXPANDED_THUMB}
                        style={{ objectFit: 'cover', borderRadius: 4, cursor: 'zoom-in' }}
                      />
                    ) : (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: EXPANDED_THUMB,
                          height: EXPANDED_THUMB,
                          borderRadius: 4,
                          background: '#fafafa',
                          fontSize: 20,
                          opacity: 0.6,
                        }}
                      >
                        {attachment.mimeType === 'application/pdf' ? <FilePdfOutlined /> : <FileOutlined />}
                      </span>
                    )
                  }
                  title={<Text style={{ fontSize: 13 }}>{attachment.fileName}</Text>}
                  description={
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {formatSize(attachment.fileSize)} · {attribution(attachment)}
                    </Text>
                  }
                />
              </List.Item>
            );
          }}
        />
      </Image.PreviewGroup>
      {removalModal}
    </Card>
  );
}
