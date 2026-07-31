import { useState } from 'react';
import { Button, Card, Modal, Space, Tag, Typography } from 'antd';
import { FileTextOutlined, PlusOutlined } from '@ant-design/icons';
import { useDocuments } from './hooks/useDocuments';
import { useInvoices } from './hooks/useInvoices';
import { DocumentsTab } from './DocumentsTab';
import { InvoiceTab } from './InvoiceTab';
import { Visit } from './types';

const { Text } = Typography;

interface DocumentsInvoiceSummaryCardProps {
  visit: Visit;
  patientName?: string;
  patientIdentifier?: string;
}

// Reserves canvas-layout space for Documents (Phase A4) and Invoices
// (Phase A5), matching the reference mockup's "Documents & Invoice"
// grouping. "+ Add" opens the full tab in a modal, same pattern as
// MedicationsSummaryCard — both need real typing room, not a compact
// inline row.
export function DocumentsInvoiceSummaryCard({ visit, patientName, patientIdentifier }: DocumentsInvoiceSummaryCardProps) {
  const { data: documents } = useDocuments(visit.id);
  const { data: invoices } = useInvoices(visit.id);
  const [openDocs, setOpenDocs] = useState(false);
  const [openInvoices, setOpenInvoices] = useState(false);

  return (
    <>
      <Card
        size="small"
        title={
          <Space>
            <FileTextOutlined /> Documents &amp; Invoice
          </Space>
        }
        style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
        styles={{
          header: { padding: '4px 12px', minHeight: 32 },
          body: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: 8 },
        }}
      >
        <Space direction="vertical" size={6} style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text>Documents</Text>
            <Space size={4}>
              <Tag>{documents?.length ?? 0}</Tag>
              <Button size="small" icon={<PlusOutlined />} onClick={() => setOpenDocs(true)} />
            </Space>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text>Invoices</Text>
            <Space size={4}>
              <Tag>{invoices?.length ?? 0}</Tag>
              <Button size="small" icon={<PlusOutlined />} onClick={() => setOpenInvoices(true)} />
            </Space>
          </div>
        </Space>
      </Card>
      <Modal title="Documents" open={openDocs} onCancel={() => setOpenDocs(false)} footer={null} width={700}>
        <DocumentsTab visit={visit} patientName={patientName} patientIdentifier={patientIdentifier} />
      </Modal>
      <Modal title="Invoices" open={openInvoices} onCancel={() => setOpenInvoices(false)} footer={null} width={700}>
        <InvoiceTab visit={visit} />
      </Modal>
    </>
  );
}
