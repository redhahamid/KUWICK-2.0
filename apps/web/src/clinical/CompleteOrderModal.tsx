import { useEffect, useState } from 'react';
import {
  Button,
  Checkbox,
  DatePicker,
  Input,
  InputNumber,
  List,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  TimePicker,
  Typography,
  Upload,
  message,
} from 'antd';
import { DeleteOutlined, DownloadOutlined, PaperClipOutlined, UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { downloadAttachment, useAttachments, useDeleteAttachment, useUploadAttachment } from './hooks/useAttachments';
import { useFormTemplateForService } from './hooks/useFormTemplates';
import { FormField, OrderService } from './types';
import { ApiError } from '../core/api-client';

const { Text } = Typography;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DynamicField({
  field,
  value,
  onChange,
  disabled,
}: {
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}) {
  switch (field.type) {
    case 'NUMBER': {
      const outOfRange =
        typeof value === 'number' &&
        ((field.normalRangeMin !== undefined && value < field.normalRangeMin) ||
          (field.normalRangeMax !== undefined && value > field.normalRangeMax));
      return (
        <Space>
          <InputNumber
            value={value as number | undefined}
            onChange={(v) => onChange(v ?? undefined)}
            disabled={disabled}
            status={outOfRange ? 'warning' : undefined}
          />
          {field.unit && <Text type="secondary">{field.unit}</Text>}
          {(field.normalRangeMin !== undefined || field.normalRangeMax !== undefined) && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              (Normal: {field.normalRangeMin ?? '—'}–{field.normalRangeMax ?? '—'})
            </Text>
          )}
          {outOfRange && <Text type="warning">Out of range</Text>}
        </Space>
      );
    }
    case 'TEXTAREA':
      return <Input.TextArea rows={2} value={value as string} onChange={(e) => onChange(e.target.value)} disabled={disabled} />;
    case 'RADIO':
      return (
        <Radio.Group value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
          <Space direction="vertical">
            {field.options?.map((option) => (
              <Radio key={option} value={option}>
                {option}
              </Radio>
            ))}
          </Space>
        </Radio.Group>
      );
    case 'CHECKBOX':
      return (
        <Checkbox.Group
          value={value as string[] | undefined}
          onChange={(checked) => onChange(checked)}
          disabled={disabled}
          options={field.options}
        />
      );
    case 'SELECT':
      return (
        <Select
          style={{ width: 240 }}
          value={value as string | undefined}
          onChange={onChange}
          disabled={disabled}
          options={field.options?.map((option) => ({ value: option, label: option }))}
        />
      );
    case 'DATE':
      return (
        <DatePicker
          value={value ? dayjs(value as string) : undefined}
          onChange={(d) => onChange(d ? d.format('YYYY-MM-DD') : undefined)}
          disabled={disabled}
        />
      );
    case 'TIME':
      return (
        <TimePicker
          value={value ? dayjs(value as string, 'HH:mm') : undefined}
          onChange={(t) => onChange(t ? t.format('HH:mm') : undefined)}
          disabled={disabled}
        />
      );
    case 'TEXT':
    default:
      return <Input value={value as string} onChange={(e) => onChange(e.target.value)} disabled={disabled} />;
  }
}

interface CompleteOrderModalProps {
  order: OrderService | null;
  onClose: () => void;
  onComplete: (id: string, result: string, formTemplateId?: string, formData?: Record<string, unknown>) => Promise<void>;
  completing: boolean;
}

// Phase A3 — task/procedure results carry free-text + attached files.
// Phase A7 — when the order's service has an admin-defined result form
// (Clinic Settings > Services & Procedures), that renders here instead of
// the bare free-text box; the plain-text `result` is still derived
// server-side from formData so every other reader keeps working.
export function CompleteOrderModal({ order, onClose, onComplete, completing }: CompleteOrderModalProps) {
  const [result, setResult] = useState('');
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const orderId = order?.id;
  const { data: attachments, isLoading: attachmentsLoading } = useAttachments(orderId);
  const { data: template } = useFormTemplateForService(order?.serviceCatalogId);
  const uploadAttachment = useUploadAttachment(orderId ?? '');
  const deleteAttachment = useDeleteAttachment(orderId ?? '');

  useEffect(() => {
    setFormValues((order?.formData as Record<string, unknown>) ?? {});
  }, [order?.id, order?.formData]);

  const handleClose = () => {
    setResult('');
    setFormValues({});
    onClose();
  };

  const handleUpload = (file: File) => {
    uploadAttachment
      .mutateAsync(file)
      .catch((error) => message.error(error instanceof ApiError ? error.message : 'Failed to upload file'));
    return false;
  };

  const handleComplete = async () => {
    if (!order) return;
    try {
      await onComplete(order.id, result, template?.id, template ? formValues : undefined);
      handleClose();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to complete');
    }
  };

  const canComplete = order?.status === 'IN_PROGRESS';

  return (
    <Modal
      title={order ? `Complete: ${order.procedureName}` : 'Complete Procedure'}
      open={Boolean(order)}
      onCancel={handleClose}
      width={template ? 600 : undefined}
      footer={
        canComplete
          ? [
              <Button key="cancel" onClick={handleClose}>
                Cancel
              </Button>,
              <Button key="complete" type="primary" loading={completing} onClick={handleComplete}>
                Mark Complete
              </Button>,
            ]
          : [
              <Button key="close" onClick={handleClose}>
                Close
              </Button>,
            ]
      }
      destroyOnHidden
    >
      {template ? (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          {template.fields.map((field) => (
            <div key={field.id}>
              <Text strong>
                {field.label}
                {field.required && <Text type="danger"> *</Text>}
              </Text>
              <div style={{ marginTop: 4 }}>
                <DynamicField
                  field={field}
                  value={formValues[field.id]}
                  onChange={(value) => setFormValues((prev) => ({ ...prev, [field.id]: value }))}
                  disabled={!canComplete}
                />
              </div>
            </div>
          ))}
        </Space>
      ) : (
        <>
          <Text type="secondary">Result</Text>
          <Input.TextArea
            style={{ marginTop: 4, marginBottom: 16 }}
            rows={3}
            placeholder="Findings, notes, or result text..."
            value={result}
            onChange={(e) => setResult(e.target.value)}
            disabled={!canComplete}
          />
        </>
      )}

      <Text type="secondary" style={{ display: 'block', marginTop: template ? 16 : 0 }}>
        Attachments
      </Text>
      <div style={{ marginTop: 4, marginBottom: 8 }}>
        <Upload beforeUpload={handleUpload} showUploadList={false} multiple>
          <Button icon={<UploadOutlined />} loading={uploadAttachment.isPending} size="small">
            Attach File
          </Button>
        </Upload>
      </div>
      <List
        size="small"
        loading={attachmentsLoading}
        dataSource={attachments}
        locale={{ emptyText: 'No files attached' }}
        renderItem={(attachment) => (
          <List.Item
            actions={[
              <Button
                key="download"
                type="text"
                size="small"
                icon={<DownloadOutlined />}
                onClick={() => downloadAttachment(order!.id, attachment)}
              />,
              <Popconfirm
                key="delete"
                title="Remove this file?"
                onConfirm={() =>
                  deleteAttachment
                    .mutateAsync(attachment.id)
                    .catch((error) => message.error(error instanceof ApiError ? error.message : 'Failed to remove file'))
                }
              >
                <Button type="text" size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>,
            ]}
          >
            <Space>
              <PaperClipOutlined />
              <span>{attachment.fileName}</span>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {formatFileSize(attachment.fileSize)}
              </Text>
            </Space>
          </List.Item>
        )}
      />
    </Modal>
  );
}
