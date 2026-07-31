import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Divider, Space, Spin, Tag, Typography } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useOrderService } from './hooks/useOrderServices';
import { useAttachments } from './hooks/useAttachments';
import { fetchBlobUrl } from '../core/api-client';
import { Attachment } from './types';

const { Title, Text, Paragraph } = Typography;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentPreview({ orderId, attachment }: { orderId: string; attachment: Attachment }) {
  const [url, setUrl] = useState<string>();
  const isImage = attachment.mimeType.startsWith('image/');

  useEffect(() => {
    if (!isImage) return;
    let objectUrl: string | undefined;
    fetchBlobUrl(`/order-services/${orderId}/attachments/${attachment.id}/download`).then((u) => {
      objectUrl = u;
      setUrl(u);
    });
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [orderId, attachment.id, isImage]);

  if (isImage) {
    return (
      <div style={{ breakInside: 'avoid', marginBottom: 16 }}>
        {url ? (
          <img src={url} alt={attachment.fileName} style={{ maxWidth: '100%', maxHeight: 480, border: '1px solid #e5e5e5' }} />
        ) : (
          <Spin />
        )}
        <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
          {attachment.fileName} ({formatFileSize(attachment.fileSize)})
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 8, fontSize: 13 }}>
      📎 {attachment.fileName} ({formatFileSize(attachment.fileSize)})
    </div>
  );
}

// Chrome-free printable view (docs/App.tsx precedent: QueueMonitorPage) —
// a formatted result sheet for a single OrderService, with clinic
// letterhead and inline image attachments (X-ray/blood results etc.),
// triggered from the Procedure Queue's "Print" action.
export function PrintOrderResultPage() {
  const { id } = useParams<{ id: string }>();
  const { data: order, isLoading } = useOrderService(id);
  const { data: attachments } = useAttachments(id);

  if (isLoading || !order) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin />
      </div>
    );
  }

  const clinic = order.visit?.clinic;
  const patient = order.visit?.patient;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 24px', fontFamily: 'sans-serif' }}>
      <div className="print-hide" style={{ textAlign: 'right', marginBottom: 16 }}>
        <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()}>
          Print
        </Button>
      </div>

      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <Title level={3} style={{ marginBottom: 0 }}>
          {clinic?.name ?? 'Clinic'}
        </Title>
        {clinic?.address && <div>{clinic.address}</div>}
        <Space size={16}>
          {clinic?.phone && <Text type="secondary">Tel: {clinic.phone}</Text>}
          {clinic?.email && <Text type="secondary">Email: {clinic.email}</Text>}
        </Space>
      </div>

      <Divider style={{ margin: '16px 0' }} />

      <Title level={4} style={{ textAlign: 'center', letterSpacing: 1 }}>
        PROCEDURE / TASK RESULT
      </Title>

      <table style={{ width: '100%', fontSize: 14, marginBottom: 16 }}>
        <tbody>
          <tr>
            <td style={{ padding: '2px 0', width: '50%' }}>
              <Text type="secondary">Patient:</Text> <Text strong>{patient?.name ?? '—'}</Text>
            </td>
            <td style={{ padding: '2px 0' }}>
              <Text type="secondary">NRIC:</Text> {patient?.identifierValue ?? '—'}
            </td>
          </tr>
          <tr>
            <td style={{ padding: '2px 0' }}>
              <Text type="secondary">Visit No:</Text> {order.visit?.visitNumber ?? '—'}
            </td>
            <td style={{ padding: '2px 0' }}>
              <Text type="secondary">Status:</Text> <Tag color="green">{order.status}</Tag>
            </td>
          </tr>
          <tr>
            <td style={{ padding: '2px 0' }}>
              <Text type="secondary">Requested By:</Text> {order.requestedBy?.fullName ?? '—'}
            </td>
            <td style={{ padding: '2px 0' }}>
              <Text type="secondary">Requested At:</Text> {dayjs(order.requestedAt).format('YYYY-MM-DD HH:mm')}
            </td>
          </tr>
          {order.completedAt && (
            <tr>
              <td style={{ padding: '2px 0' }} colSpan={2}>
                <Text type="secondary">Completed At:</Text> {dayjs(order.completedAt).format('YYYY-MM-DD HH:mm')}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <Divider style={{ margin: '12px 0' }} />

      <Title level={5}>{order.procedureName}</Title>
      {order.instruction && (
        <Paragraph type="secondary" style={{ marginBottom: 8 }}>
          Instruction: {order.instruction}
        </Paragraph>
      )}

      <Text strong>Result</Text>
      <Paragraph style={{ whiteSpace: 'pre-wrap', border: '1px solid #e5e5e5', borderRadius: 4, padding: 12, minHeight: 60 }}>
        {order.result || '—'}
      </Paragraph>

      {attachments && attachments.length > 0 && (
        <>
          <Text strong>Attachments</Text>
          <div style={{ marginTop: 8 }}>
            {attachments.map((attachment) => (
              <AttachmentPreview key={attachment.id} orderId={order.id} attachment={attachment} />
            ))}
          </div>
        </>
      )}

      <Divider style={{ margin: '24px 0 8px' }} />
      <Text type="secondary" style={{ fontSize: 12 }}>
        Printed {dayjs().format('YYYY-MM-DD HH:mm')}
      </Text>

      <style>{`@media print { .print-hide { display: none !important; } }`}</style>
    </div>
  );
}
