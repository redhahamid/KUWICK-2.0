import { useState } from 'react';
import { Card, Col, DatePicker, Row, Select, Space, Statistic, Table, Tabs, Tag, Typography } from 'antd';
import { Column, Pie } from '@ant-design/plots';
import dayjs, { Dayjs } from 'dayjs';
import { useClinics } from '../core/hooks/useClinics';
import { OutstandingClaimBatch } from '../clinical/types';
import { useAppointmentAnalytics, useDoctorPerformance, useReportsPanelAging, useSalesSummary } from './hooks/useReports';
import { DoctorPerformance } from './types';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

const BATCH_STATUS_COLOR: Record<string, string> = {
  SUBMITTED: 'blue',
  PARTIALLY_PAID: 'gold',
  PAID: 'green',
};

function SalesTab({ from, to, clinicId }: { from?: string; to?: string; clinicId?: string }) {
  const { data: sales, isLoading } = useSalesSummary({ from, to, clinicId });

  const chartData = (sales?.byDay ?? []).flatMap((day) => [
    { date: day.date, type: 'Cash Collected', value: day.cash },
    { date: day.date, type: 'Panel Owed', value: day.panel },
  ]);

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card size="small" loading={isLoading}>
            <Statistic title="Total Revenue (RM)" value={sales?.totalRevenue ?? 0} precision={2} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" loading={isLoading}>
            <Statistic title="Cash Collected (RM)" value={sales?.cashRevenue ?? 0} precision={2} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" loading={isLoading}>
            <Statistic title="Panel Owed (RM)" value={sales?.panelRevenue ?? 0} precision={2} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" loading={isLoading}>
            <Statistic title="Paid Invoices" value={sales?.invoiceCount ?? 0} />
          </Card>
        </Col>
      </Row>
      <Card size="small" title="Revenue Trend — Cash vs Panel" style={{ marginBottom: 16 }}>
        {chartData.length > 0 ? (
          <Column
            data={chartData}
            xField="date"
            yField="value"
            colorField="type"
            stack
            height={260}
            axis={{ y: { labelFormatter: (v: number) => `RM ${v}` } }}
          />
        ) : (
          <Text type="secondary">No paid invoices in this range yet</Text>
        )}
      </Card>
      <Card size="small" title="By Payment Method">
        <Table
          size="small"
          rowKey="paymentMethod"
          pagination={false}
          dataSource={sales?.byPaymentMethod}
          columns={[
            { title: 'Payment Method', dataIndex: 'paymentMethod' },
            { title: 'Amount (RM)', dataIndex: 'amount' },
          ]}
        />
      </Card>
    </div>
  );
}

function AppointmentsTab({ from, to, clinicId }: { from?: string; to?: string; clinicId?: string }) {
  const { data: analytics, isLoading } = useAppointmentAnalytics({ from, to, clinicId });

  const pieData = Object.entries(analytics?.countByStatus ?? {})
    .filter(([, count]) => count > 0)
    .map(([status, count]) => ({ status, count }));

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card size="small" loading={isLoading}>
            <Statistic title="Total Appointments" value={analytics?.total ?? 0} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" loading={isLoading}>
            <Statistic title="Completed Rate" value={analytics?.completedRate ?? 0} suffix="%" />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" loading={isLoading}>
            <Statistic title="No-Show Rate" value={analytics?.noShowRate ?? 0} suffix="%" />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" loading={isLoading}>
            <Statistic title="Cancelled Rate" value={analytics?.cancelledRate ?? 0} suffix="%" />
          </Card>
        </Col>
      </Row>
      <Card size="small" title="Appointments by Status">
        {pieData.length > 0 ? (
          <Pie data={pieData} angleField="count" colorField="status" height={260} label={{ text: 'count' }} />
        ) : (
          <Text type="secondary">No appointments in this range yet</Text>
        )}
      </Card>
    </div>
  );
}

function DoctorPerformanceTab({ from, to, clinicId }: { from?: string; to?: string; clinicId?: string }) {
  const { data: performance, isLoading } = useDoctorPerformance({ from, to, clinicId });

  return (
    <Table
      size="small"
      rowKey="staffId"
      loading={isLoading}
      dataSource={performance}
      locale={{ emptyText: 'No paid invoices in this range yet' }}
      columns={[
        { title: 'Doctor', dataIndex: 'staffName' },
        { title: 'Patients Seen', dataIndex: 'visitCount', sorter: (a: DoctorPerformance, b: DoctorPerformance) => a.visitCount - b.visitCount },
        { title: 'Revenue (RM)', dataIndex: 'revenue', sorter: (a: DoctorPerformance, b: DoctorPerformance) => a.revenue - b.revenue },
        { title: 'Revenue per Patient (RM)', dataIndex: 'revenuePerVisit' },
      ]}
    />
  );
}

function PanelAgingTab() {
  const { data: outstanding, isLoading } = useReportsPanelAging();

  return (
    <Table
      size="small"
      rowKey="id"
      loading={isLoading}
      dataSource={outstanding}
      locale={{ emptyText: 'Nothing outstanding — every submitted claim is fully paid or reconciled' }}
      columns={[
        { title: 'Panel', render: (_: unknown, r: OutstandingClaimBatch) => r.panelClinic?.name },
        { title: 'Batch No.', dataIndex: 'batchNumber' },
        { title: 'Status', render: (_: unknown, r: OutstandingClaimBatch) => <Tag color={BATCH_STATUS_COLOR[r.status]}>{r.status}</Tag> },
        { title: 'Claimed (RM)', render: (_: unknown, r: OutstandingClaimBatch) => r.claimedTotal.toFixed(2) },
        { title: 'Outstanding (RM)', render: (_: unknown, r: OutstandingClaimBatch) => r.outstandingAmount.toFixed(2) },
        {
          title: 'Days Outstanding',
          dataIndex: 'daysOutstanding',
          sorter: (a: OutstandingClaimBatch, b: OutstandingClaimBatch) => a.daysOutstanding - b.daysOutstanding,
        },
      ]}
    />
  );
}

// Reports & Analytics, Phase 1f (MVP scope only, PRODUCT_REQUIREMENTS.md
// §14): Sales (cash vs panel), Appointment Analytics, Doctor Performance,
// Panel Aging. Lives under Management, its own top-level group.
export function ReportsPage() {
  const { data: clinics } = useClinics();
  const [clinicId, setClinicId] = useState<string>();
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>([dayjs().subtract(30, 'day'), dayjs()]);

  const from = range?.[0]?.format('YYYY-MM-DD');
  const to = range?.[1]?.format('YYYY-MM-DD');

  return (
    <div style={{ paddingTop: 24, paddingBottom: 24 }}>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }} wrap>
        <Title level={4} style={{ margin: 0 }}>
          Executive Dashboard
        </Title>
        <Space>
          <RangePicker value={range} onChange={(dates) => setRange(dates as [Dayjs, Dayjs] | null)} />
          <Select
            allowClear
            style={{ width: 200 }}
            placeholder="All clinics"
            value={clinicId}
            onChange={setClinicId}
            options={clinics?.map((clinic) => ({ value: clinic.id, label: clinic.name }))}
          />
        </Space>
      </Space>
      <Tabs
        items={[
          { key: 'sales', label: 'Sales', children: <SalesTab from={from} to={to} clinicId={clinicId} /> },
          { key: 'appointments', label: 'Appointments', children: <AppointmentsTab from={from} to={to} clinicId={clinicId} /> },
          { key: 'doctors', label: 'Doctor Performance', children: <DoctorPerformanceTab from={from} to={to} clinicId={clinicId} /> },
          { key: 'panel-aging', label: 'Panel Aging', children: <PanelAgingTab /> },
        ]}
      />
    </div>
  );
}
