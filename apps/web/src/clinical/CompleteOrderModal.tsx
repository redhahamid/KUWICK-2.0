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
import { CompressOutlined, DeleteOutlined, DownloadOutlined, ExpandOutlined, PaperClipOutlined, UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { downloadAttachment, useAttachments, useDeleteAttachment, useUploadAttachment } from './hooks/useAttachments';
import { useFormTemplateForService } from './hooks/useFormTemplates';
import { useOrderChat, useSendOrderChat } from './hooks/useChat';
import { ChatPanel } from './ChatPanel';
import { FormField, OrderService } from './types';
import { ApiError } from '../core/api-client';
import { useAuthStore } from '../core/auth-store';

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
  const [fullscreen, setFullscreen] = useState(false);
  const orderId = order?.id;
  const staff = useAuthStore((state) => state.staff);
  const { data: attachments, isLoading: attachmentsLoading } = useAttachments(orderId);
  const { data: template } = useFormTemplateForService(order?.serviceCatalogId);
  const uploadAttachment = useUploadAttachment(orderId ?? '');
  const deleteAttachment = useDeleteAttachment(orderId ?? '');
  const { data: orderChat, isLoading: orderChatLoading } = useOrderChat(orderId);
  const sendOrderChat = useSendOrderChat(orderId);

  useEffect(() => {
    setResult(order?.result ?? '');
    setFormValues((order?.formData as Record<string, unknown>) ?? {});
  }, [order?.id, order?.result, order?.formData]);

  const handleClose = () => {
    setResult('');
    setFormValues({});
    setFullscreen(false);
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
  const hasTemplateValues = Object.keys(formValues).length > 0;

  return (
    <Modal
      title={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 32 }}>
          <span>{order ? `Complete: ${order.procedureName}` : 'Complete Procedure'}</span>
          <Button
            type="text"
            size="small"
            icon={fullscreen ? <CompressOutlined /> : <ExpandOutlined />}
            onClick={() => setFullscreen((f) => !f)}
            title={fullscreen ? 'Exit fullscreen' : 'Expand to fullscreen'}
          />
        </div>
      }
      open={Boolean(order)}
      onCancel={handleClose}
      width={fullscreen ? '95vw' : template ? 600 : undefined}
      style={fullscreen ? { top: 16 } : undefined}
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
      <div style={{ display: 'flex', gap: 24, flexDirection: fullscreen ? 'row' : 'column' }}>
        <div style={{ flex: fullscreen ? '1 1 60%' : '1 1 auto', minWidth: 0, maxHeight: fullscreen ? '78vh' : undefined, overflowY: fullscreen ? 'auto' : undefined }}>
          {/* A form template is looked up by service, not by this order instance — an order
              completed before the template existed has a free-text `result` but no `formData`.
              Showing the template's (empty) fields for that order would silently hide its real
              historical result, so a view-only order with no form values falls back to the
              plain text instead of the dynamic form. */}
          {template && (canComplete || hasTemplateValues) ? (
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
          ) : template ? (
            <>
              <Text type="secondary">Result</Text>
              <div
                style={{
                  marginTop: 4,
                  marginBottom: 16,
                  padding: '8px 12px',
                  background: '#fafafa',
                  borderRadius: 4,
                  whiteSpace: 'pre-wrap',
                  fontSize: 13,
                }}
              >
                {order?.result || 'No result recorded'}
              </div>
            </>
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
        </div>

        {order && (
          <div
            style={{
              flex: fullscreen ? '1 1 40%' : '1 1 auto',
              minWidth: 0,
              borderLeft: fullscreen ? '1px solid #f0f0f0' : undefined,
              paddingLeft: fullscreen ? 20 : 0,
              borderTop: fullscreen ? undefined : '1px solid #f0f0f0',
              paddingTop: fullscreen ? 0 : 12,
              marginTop: fullscreen ? 0 : 16,
            }}
          >
            <Text type="secondary" style={{ display: 'block', marginBottom: 6 }}>
              Chat about this procedure
            </Text>
            <ChatPanel
              messages={orderChat}
              isLoading={orderChatLoading}
              currentStaffId={staff?.id}
              onSend={(text) =>
                sendOrderChat.mutateAsync(text).catch((error) => message.error(error instanceof ApiError ? error.message : 'Failed to send'))
              }
              sending={sendOrderChat.isPending}
              height={fullscreen ? 560 : 200}
              emptyText="No messages yet — ask about this procedure"
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
