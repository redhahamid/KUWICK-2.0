import { useState } from 'react';
import { Button, Card, Select, Space, Table, Tag, Typography } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useInvoiceListing } from './hooks/useReports';
import { ReportRange, ReportRangeBar, defaultRange } from './ReportRangeBar';
import { exportCsv } from './exportCsv';
import { InvoiceListingRow } from './types';

const { Title } = Typography;

const STATUS_COLOR: Record<string, string> = { PAID: 'green', UNPAID: 'orange', CANCELLED: 'default' };

// D-039 — "invoice / sale listings" + "outstanding invoice": the same
// listing with the status filter set to UNPAID is the outstanding report.
export function InvoiceListingPage() {
  const [range, setRange] = useState<ReportRange>(defaultRange(30));
  const [status, setStatus] = useState<string>();
  const { data, isLoading } = useInvoiceListing({ ...range, status });

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }} wrap>
        <Title level={4} style={{ margin: 0 }}>
          Invoice Listing
        </Title>
        <Space>
          <Select
            allowClear
            placeholder="All statuses"
            style={{ width: 160 }}
            value={status}
            onChange={setStatus}
            options={[
              { value: 'PAID', label: 'Paid' },
              { value: 'UNPAID', label: 'Outstanding (Unpaid)' },
              { value: 'CANCELLED', label: 'Cancelled' },
            ]}
          />
          <ReportRangeBar value={range} onChange={setRange} />
          <Button
            icon={<DownloadOutlined />}
            onClick={() => data && exportCsv(`invoices-${range.from}-${range.to}`, data)}
          >
            CSV
          </Button>
        </Space>
      </Space>
      <Card>
        <Table
          rowKey="id"
          size="small"
          loading={isLoading}
          dataSource={data}
          columns={[
            { title: 'Invoice No.', dataIndex: 'invoiceNumber' },
            {
              title: 'Status',
              render: (_: unknown, r: InvoiceListingRow) => <Tag color={STATUS_COLOR[r.status]}>{r.status}</Tag>,
            },
            { title: 'Patient', dataIndex: 'patientName' },
            { title: 'Doctor', dataIndex: 'doctorName' },
            {
              title: 'Billing',
              render: (_: unknown, r: InvoiceListingRow) => r.panelName ?? r.billingType,
            },
            { title: 'Total (RM)', render: (_: unknown, r: InvoiceListingRow) => r.totalAmount.toFixed(2) },
            {
              title: 'Patient Paid (RM)',
              render: (_: unknown, r: InvoiceListingRow) => r.patientPaidAmount.toFixed(2),
            },
            {
              title: 'Panel (RM)',
              render: (_: unknown, r: InvoiceListingRow) => r.panelCoveredAmount.toFixed(2),
            },
            { title: 'Method', render: (_: unknown, r: InvoiceListingRow) => r.paymentMethod ?? '—' },
            {
              title: 'Date',
              render: (_: unknown, r: InvoiceListingRow) =>
                dayjs(r.paidAt ?? r.createdAt).format('YYYY-MM-DD HH:mm'),
            },
          ]}
        />
      </Card>
    </div>
  );
}
