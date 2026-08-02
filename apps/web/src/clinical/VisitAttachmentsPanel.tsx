import { useRef } from 'react';
import { Button, Card, Image, List, Popconfirm, Space, Tag, Tooltip, Typography, message } from 'antd';
import {
  DeleteOutlined,
  DownloadOutlined,
  FileOutlined,
  FilePdfOutlined,
  PaperClipOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useAuthStore } from '../core/auth-store';
import {
  downloadVisitAttachment,
  useDeleteVisitAttachment,
  useUploadVisitAttachment,
  useVisitAttachments,
} from './hooks/useVisitAttachments';
import { useAttachmentBlobUrls } from './hooks/useAttachmentBlobUrls';
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
  const deleteAttachment = useDeleteVisitAttachment(visitId);
  const currentStaff = useAuthStore((state) => state.staff);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const blobUrls = useAttachmentBlobUrls(visitId, attachments);

  const handleFileChosen = async (file: File | undefined) => {
    if (!file) return;
    try {
      await uploadAttachment.mutateAsync({ file, uploadedByStaffId: currentStaff?.id });
      message.success('File uploaded');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to upload file');
    }
  };

  const handleDelete = async (attachmentId: string) => {
    try {
      await deleteAttachment.mutateAsync(attachmentId);
      message.success('Attachment removed');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to remove attachment');
    }
  };

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
                width={40}
                height={40}
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
                  <Popconfirm key="delete" title="Remove this attachment?" onConfirm={() => handleDelete(attachment.id)}>
                    <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  avatar={
                    url ? (
                      <Image
                        src={url}
                        alt={attachment.fileName}
                        width={48}
                        height={48}
                        style={{ objectFit: 'cover', borderRadius: 4, cursor: 'zoom-in' }}
                      />
                    ) : (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 48,
                          height: 48,
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
    </Card>
  );
}
