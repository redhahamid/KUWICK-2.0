import { useState } from 'react';
import { Button, Card, Space, Table, Typography } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { Column } from '@ant-design/plots';
import { useDoctorPerformanceDetailed } from './hooks/useReports';
import { ReportRange, ReportRangeBar, defaultRange } from './ReportRangeBar';
import { exportCsv } from './exportCsv';
import { DoctorPerformanceDetailed } from './types';

const { Title } = Typography;

// D-039 — the reference's RESIDENTS PERFORMANCE ANALYSIS DASHBOARD:
// per-doctor patients / sales / Consultation-Drugs-Services-Others revenue
// / average charge per patient. The reference's per-doctor SCORE is a DAX
// formula not recoverable from the report file — deliberately not invented
// (same treatment as the incentive formula, OQ#2).
export function DoctorPerformancePage() {
  const [range, setRange] = useState<ReportRange>(defaultRange(30));
  const { data, isLoading } = useDoctorPerformanceDetailed(range);

  const revenueByCategory = (data ?? []).flatMap((doctor) => [
    { doctor: doctor.staffName, category: 'Consultation', amount: doctor.consultationRevenue },
    { doctor: doctor.staffName, category: 'Drugs', amount: doctor.drugsRevenue },
    { doctor: doctor.staffName, category: 'Services', amount: doctor.servicesRevenue },
    { doctor: doctor.staffName, category: 'Others', amount: doctor.othersRevenue },
  ]);

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }} wrap>
        <Title level={4} style={{ margin: 0 }}>
          Doctor Performance
        </Title>
        <Space>
          <ReportRangeBar value={range} onChange={setRange} />
          <Button
            icon={<DownloadOutlined />}
            onClick={() => data && exportCsv(`doctor-performance-${range.from}-${range.to}`, data)}
          >
            CSV
          </Button>
        </Space>
      </Space>
      <Card title="% of Revenue by Category (by Doctors)" loading={isLoading} style={{ marginBottom: 16 }}>
        <Column
          data={revenueByCategory}
          xField="doctor"
          yField="amount"
          colorField="category"
          stack
          height={280}
          legend={{ color: { position: 'top' } }}
        />
      </Card>
      <Card loading={isLoading}>
        <Table
          rowKey="staffId"
          size="small"
          dataSource={data}
          pagination={false}
          columns={[
            { title: 'Doctor', dataIndex: 'staffName' },
            { title: 'No. Patients', dataIndex: 'patients' },
            { title: 'Sales (RM)', render: (_: unknown, r: DoctorPerformanceDetailed) => r.sales.toFixed(2) },
            {
              title: 'Consultation (RM)',
              render: (_: unknown, r: DoctorPerformanceDetailed) => r.consultationRevenue.toFixed(2),
            },
            { title: 'Drugs (RM)', render: (_: unknown, r: DoctorPerformanceDetailed) => r.drugsRevenue.toFixed(2) },
            {
              title: 'Services (RM)',
              render: (_: unknown, r: DoctorPerformanceDetailed) => r.servicesRevenue.toFixed(2),
            },
            { title: 'Others (RM)', render: (_: unknown, r: DoctorPerformanceDetailed) => r.othersRevenue.toFixed(2) },
            {
              title: 'Avg / Patient (RM)',
              render: (_: unknown, r: DoctorPerformanceDetailed) => r.averageChargePerPatient.toFixed(2),
            },
          ]}
        />
      </Card>
    </div>
  );
}
