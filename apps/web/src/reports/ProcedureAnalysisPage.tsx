import { useState } from 'react';
import { Button, Card, Col, Row, Space, Statistic, Table, Typography } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { Pie } from '@ant-design/plots';
import { useProcedureAnalysis } from './hooks/useReports';
import { ReportRange, ReportRangeBar, defaultRange } from './ReportRangeBar';
import { exportCsv } from './exportCsv';

const { Title } = Typography;

// D-039 — the reference's PROCEDURE ANALYSIS DASHBOARD: revenue and count
// by charge description / charge-description group / doctor — "to see
// which procedure highest and lowest done".
export function ProcedureAnalysisPage() {
  const [range, setRange] = useState<ReportRange>(defaultRange(30));
  const { data, isLoading } = useProcedureAnalysis(range);

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }} wrap>
        <Title level={4} style={{ margin: 0 }}>
          Procedure Analysis
        </Title>
        <Space>
          <ReportRangeBar value={range} onChange={setRange} />
          <Button
            icon={<DownloadOutlined />}
            onClick={() => data && exportCsv(`procedures-${range.from}-${range.to}`, data.byDescription)}
          >
            CSV
          </Button>
        </Space>
      </Space>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card loading={isLoading}>
            <Statistic title="Procedure Revenue" value={data?.totalRevenue ?? 0} precision={2} prefix="RM" />
          </Card>
        </Col>
        <Col span={6}>
          <Card loading={isLoading}>
            <Statistic title="Procedures Done" value={data?.lineCount ?? 0} />
          </Card>
        </Col>
      </Row>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card title="% by Charge Description Group" loading={isLoading}>
            <Pie
              data={(data?.byGroup ?? []).map((g) => ({ type: g.group as string, value: g.revenue as number }))}
              angleField="value"
              colorField="type"
              height={240}
              label={{ text: 'type', position: 'outside' }}
              legend={{ color: { position: 'bottom' } }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card title="% by Doctors" loading={isLoading}>
            <Pie
              data={(data?.byDoctor ?? []).map((d) => ({ type: d.doctorName, value: d.revenue }))}
              angleField="value"
              colorField="type"
              height={240}
              label={{ text: 'type', position: 'outside' }}
              legend={{ color: { position: 'bottom' } }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card title="Revenue by Group" loading={isLoading}>
            <Table
              rowKey="group"
              size="small"
              pagination={false}
              dataSource={data?.byGroup}
              columns={[
                { title: 'Group', dataIndex: 'group' },
                { title: 'Count', dataIndex: 'count' },
                { title: 'Revenue (RM)', render: (_: unknown, r) => (r.revenue as number).toFixed(2) },
              ]}
            />
          </Card>
        </Col>
      </Row>
      <Card title="% by Charge Description" loading={isLoading}>
        <Table
          rowKey="description"
          size="small"
          dataSource={data?.byDescription}
          columns={[
            { title: 'Charge Description', dataIndex: 'description' },
            { title: 'Times Done', dataIndex: 'count', sorter: (a, b) => (a.count as number) - (b.count as number) },
            {
              title: 'Revenue (RM)',
              render: (_: unknown, r) => (r.revenue as number).toFixed(2),
              sorter: (a, b) => (a.revenue as number) - (b.revenue as number),
              defaultSortOrder: 'descend' as const,
            },
          ]}
        />
      </Card>
    </div>
  );
}
