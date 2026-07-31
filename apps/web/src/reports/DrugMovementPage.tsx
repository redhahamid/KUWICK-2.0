import { useState } from 'react';
import { Button, Card, Col, Row, Space, Statistic, Table, Tag, Typography } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { Column } from '@ant-design/plots';
import { useDrugMovement } from './hooks/useReports';
import { ReportRange, ReportRangeBar, defaultRange } from './ReportRangeBar';
import { exportCsv } from './exportCsv';
import { DrugMovementRow } from './types';

const { Title } = Typography;

const MOVEMENT_TAG: Record<DrugMovementRow['movement'], { color: string; label: string }> = {
  FAST: { color: 'green', label: 'Fast Moving' },
  MEDIUM: { color: 'blue', label: 'Medium' },
  SLOW: { color: 'orange', label: 'Slow Moving' },
};

// D-042 — the owner's "drug revenue — fast moving vs slow moving" report:
// dispensed-drug sales ranked by quantity, never-sold items surfaced as
// slow movers so dead stock is visible.
export function DrugMovementPage() {
  const [range, setRange] = useState<ReportRange>(defaultRange(30));
  const { data: rows, isLoading } = useDrugMovement(range);

  const totalRevenue = (rows ?? []).reduce((sum, row) => sum + row.revenue, 0);
  const totalQuantity = (rows ?? []).reduce((sum, row) => sum + row.quantity, 0);
  const slowCount = (rows ?? []).filter((row) => row.movement === 'SLOW').length;
  const topTen = (rows ?? []).filter((row) => row.quantity > 0).slice(0, 10);

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }} wrap>
        <Title level={4} style={{ margin: 0 }}>
          Drug Revenue — Fast vs Slow Moving
        </Title>
        <Space>
          <ReportRangeBar value={range} onChange={setRange} />
          <Button
            icon={<DownloadOutlined />}
            disabled={!rows?.length}
            onClick={() => rows && exportCsv(`drug-movement-${range.from}-${range.to}`, rows)}
          >
            CSV
          </Button>
        </Space>
      </Space>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card loading={isLoading}>
            <Statistic title="Drug Revenue" value={totalRevenue} precision={2} prefix="RM" />
          </Card>
        </Col>
        <Col span={8}>
          <Card loading={isLoading}>
            <Statistic title="Units Dispensed" value={totalQuantity} />
          </Card>
        </Col>
        <Col span={8}>
          <Card loading={isLoading}>
            <Statistic title="Slow / Dead Stock Items" value={slowCount} valueStyle={{ color: '#d97706' }} />
          </Card>
        </Col>
      </Row>
      <Card title="Top 10 by Quantity Dispensed" loading={isLoading} style={{ marginBottom: 16 }}>
        <Column
          data={topTen.map((row) => ({ name: row.name, quantity: row.quantity }))}
          xField="name"
          yField="quantity"
          height={240}
          axis={{ x: { labelAutoHide: true } }}
        />
      </Card>
      <Card loading={isLoading}>
        <Table
          rowKey="itemId"
          size="small"
          dataSource={rows}
          columns={[
            { title: 'Drug', dataIndex: 'name' },
            { title: 'Category', render: (_: unknown, r: DrugMovementRow) => r.category ?? '—' },
            {
              title: 'Movement',
              filters: Object.entries(MOVEMENT_TAG).map(([value, tag]) => ({ value, text: tag.label })),
              onFilter: (value, r: DrugMovementRow) => r.movement === value,
              render: (_: unknown, r: DrugMovementRow) => (
                <Tag color={MOVEMENT_TAG[r.movement].color}>{MOVEMENT_TAG[r.movement].label}</Tag>
              ),
            },
            {
              title: 'Qty Dispensed',
              dataIndex: 'quantity',
              sorter: (a: DrugMovementRow, b: DrugMovementRow) => a.quantity - b.quantity,
              defaultSortOrder: 'descend' as const,
            },
            { title: 'Prescriptions', dataIndex: 'prescriptions' },
            {
              title: 'Revenue (RM)',
              render: (_: unknown, r: DrugMovementRow) => r.revenue.toFixed(2),
              sorter: (a: DrugMovementRow, b: DrugMovementRow) => a.revenue - b.revenue,
            },
          ]}
        />
      </Card>
    </div>
  );
}
