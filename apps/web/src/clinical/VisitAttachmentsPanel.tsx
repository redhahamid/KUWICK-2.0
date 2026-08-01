import { useRef } from 'react';
import { Button, Card, List, Popconfirm, Space, Tag, Typography, message } from 'antd';
import { DeleteOutlined, DownloadOutlined, PaperClipOutlined, UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useAuthStore } from '../core/auth-store';
import {
  downloadVisitAttachment,
  useDeleteVisitAttachment,
  useUploadVisitAttachment,
  useVisitAttachments,
} from './hooks/useVisitAttachments';
import { ApiError } from '../core/api-client';
import { VisitAttachment } from './types';

const { Text } = Typography;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface VisitAttachmentsPanelProps {
  visitId: string;
  compact?: boolean;
}

// D-044 — images/PDFs/results attached to the visit itself, not tied to a
// specific order/procedure — placed above the Clinical Notes/Vitals card so
// staff can drop in a photo or scanned result without leaving the record.
export function VisitAttachmentsPanel({ visitId, compact }: VisitAttachmentsPanelProps) {
  const { data: attachments, isLoading } = useVisitAttachments(visitId);
  const uploadAttachment = useUploadVisitAttachment(visitId);
  const deleteAttachment = useDeleteVisitAttachment(visitId);
  const currentStaff = useAuthStore((state) => state.staff);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  return (
    <Card
      size="small"
      title={
        <Space>
          <PaperClipOutlined /> Attachments
          {attachments && attachments.length > 0 && <Tag>{attachments.length}</Tag>}
        </Space>
      }
      style={{ marginBottom: compact ? 6 : 8 }}
      styles={
        compact
          ? { header: { padding: '2px 10px', minHeight: 24 }, body: { padding: '6px 10px' } }
          : { header: { padding: '4px 12px', minHeight: 32 }, body: { padding: '8px 12px' } }
      }
      extra={
        <>
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
      <List
        size="small"
        loading={isLoading}
        dataSource={attachments}
        locale={{ emptyText: 'No files attached yet' }}
        renderItem={(attachment: VisitAttachment) => (
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
            <Space direction="vertical" size={0}>
              <Text style={{ fontSize: compact ? 12 : 13 }}>{attachment.fileName}</Text>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {formatSize(attachment.fileSize)} · {dayjs(attachment.createdAt).format('D MMM, HH:mm')}
                {attachment.uploadedBy ? ` · ${attachment.uploadedBy.fullName}` : ''}
              </Text>
            </Space>
          </List.Item>
        )}
      />
    </Card>
  );
}
