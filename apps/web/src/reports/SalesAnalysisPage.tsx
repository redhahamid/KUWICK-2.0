import { useState } from 'react';
import { Button, Card, Col, Row, Space, Statistic, Typography } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { Column, Pie } from '@ant-design/plots';
import { useSalesAnalysis } from './hooks/useReports';
import { ReportRange, ReportRangeBar, defaultRange } from './ReportRangeBar';
import { exportCsv } from './exportCsv';

const { Title } = Typography;

function pieConfig(data: { type: string; value: number }[]) {
  return {
    data,
    angleField: 'value',
    colorField: 'type',
    height: 260,
    innerRadius: 0,
    label: { text: 'type', position: 'outside' as const },
    legend: { color: { position: 'bottom' as const } },
  };
}

// D-039 — the reference's SALES ANALYSIS DASHBOARD: panel vs non-panel
// sales, revenue by category, % of sales by doctor / by panel company,
// average charges, and the daily sales trend.
export function SalesAnalysisPage() {
  const [range, setRange] = useState<ReportRange>(defaultRange(30));
  const { data, isLoading } = useSalesAnalysis(range);

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }} wrap>
        <Title level={4} style={{ margin: 0 }}>
          Sales Analysis
        </Title>
        <Space>
          <ReportRangeBar value={range} onChange={setRange} />
          <Button
            icon={<DownloadOutlined />}
            onClick={() => data && exportCsv(`sales-by-day-${range.from}-${range.to}`, data.byDay)}
          >
            CSV
          </Button>
        </Space>
      </Space>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={4}>
          <Card loading={isLoading}>
            <Statistic title="Total Sales" value={data?.totalSales ?? 0} precision={2} prefix="RM" />
          </Card>
        </Col>
        <Col span={4}>
          <Card loading={isLoading}>
            <Statistic title="Panel Sales" value={data?.panelSales ?? 0} precision={2} prefix="RM" valueStyle={{ color: '#2f5bf6' }} />
          </Card>
        </Col>
        <Col span={4}>
          <Card loading={isLoading}>
            <Statistic title="Non-Panel Sales" value={data?.nonPanelSales ?? 0} precision={2} prefix="RM" valueStyle={{ color: '#16a34a' }} />
          </Card>
        </Col>
        <Col span={4}>
          <Card loading={isLoading}>
            <Statistic title="Avg Charge / Patient" value={data?.averageChargePerPatient ?? 0} precision={2} prefix="RM" />
          </Card>
        </Col>
        <Col span={4}>
          <Card loading={isLoading}>
            <Statistic title="Avg / Panel Patient" value={data?.averageChargePerPanelPatient ?? 0} precision={2} prefix="RM" />
          </Card>
        </Col>
        <Col span={4}>
          <Card loading={isLoading}>
            <Statistic title="Avg / Non-Panel" value={data?.averageChargePerNonPanelPatient ?? 0} precision={2} prefix="RM" />
          </Card>
        </Col>
      </Row>
      <Card title="Total Sales & Patients by Day" loading={isLoading} style={{ marginBottom: 16 }}>
        <Column
          data={data?.byDay ?? []}
          xField="date"
          yField="sales"
          height={260}
          axis={{ x: { labelAutoHide: true } }}
        />
      </Card>
      <Row gutter={16}>
        <Col span={6}>
          <Card title="% of Non-Panel & Panel Sales" loading={isLoading}>
            <Pie
              {...pieConfig([
                { type: 'Panel', value: data?.panelSales ?? 0 },
                { type: 'Non-Panel', value: data?.nonPanelSales ?? 0 },
              ])}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card title="% of Revenue by Category" loading={isLoading}>
            <Pie {...pieConfig((data?.byCategory ?? []).map((c) => ({ type: c.category, value: c.amount })))} />
          </Card>
        </Col>
        <Col span={6}>
          <Card title="% of Sales by Doctors" loading={isLoading}>
            <Pie {...pieConfig((data?.byDoctor ?? []).map((d) => ({ type: d.doctorName, value: d.amount })))} />
          </Card>
        </Col>
        <Col span={6}>
          <Card title="% of Sales by Panel Company" loading={isLoading}>
            <Pie {...pieConfig((data?.byPanel ?? []).map((p) => ({ type: p.panelName, value: p.amount })))} />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
