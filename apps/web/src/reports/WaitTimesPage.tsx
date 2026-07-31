import { useState } from 'react';
import { Card, Col, Row, Space, Statistic, Typography } from 'antd';
import { Column } from '@ant-design/plots';
import { useWaitTimes } from './hooks/useReports';
import { ReportRange, ReportRangeBar, defaultRange } from './ReportRangeBar';

const { Title, Text } = Typography;

function formatMinutes(value: number | null): string {
  if (value == null) return '—';
  if (value < 60) return `${value} min`;
  return `${Math.floor(value / 60)}h ${Math.round(value % 60)}m`;
}

// D-042 — the owner's "waiting-consultation-dispensary time" analysis,
// from timestamps the system already records: queue-ticket creation →
// called (waiting), called → check-out (consultation+dispensary),
// check-in → check-out (total visit).
export function WaitTimesPage() {
  const [range, setRange] = useState<ReportRange>(defaultRange(30));
  const { data, isLoading } = useWaitTimes(range);

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }} wrap>
        <Title level={4} style={{ margin: 0 }}>
          Waiting Time Analysis
        </Title>
        <ReportRangeBar value={range} onChange={setRange} />
      </Space>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card loading={isLoading}>
            <Statistic title="Visits" value={data?.visitCount ?? 0} />
          </Card>
        </Col>
        <Col span={6}>
          <Card loading={isLoading}>
            <Statistic
              title="Avg Wait to Be Called"
              value={formatMinutes(data?.averageWaitMinutes ?? null)}
              valueStyle={{ color: (data?.averageWaitMinutes ?? 0) > 30 ? '#dc2626' : '#16a34a' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card loading={isLoading}>
            <Statistic title="Avg Consultation + Dispensary" value={formatMinutes(data?.averageServiceMinutes ?? null)} />
          </Card>
        </Col>
        <Col span={6}>
          <Card loading={isLoading}>
            <Statistic title="Avg Total Visit" value={formatMinutes(data?.averageTotalVisitMinutes ?? null)} />
          </Card>
        </Col>
      </Row>
      <Row gutter={16}>
        <Col span={10}>
          <Card title="Wait Time Distribution" loading={isLoading}>
            <Column data={data?.waitBuckets ?? []} xField="bucket" yField="count" height={240} />
            <Text type="secondary" style={{ fontSize: 12 }}>
              Time from joining the queue to being called ({data?.measuredWaits ?? 0} measured).
            </Text>
          </Card>
        </Col>
        <Col span={14}>
          <Card title="Average Wait by Day" loading={isLoading}>
            <Column
              data={data?.byDay ?? []}
              xField="date"
              yField="averageWaitMinutes"
              height={240}
              axis={{ x: { labelAutoHide: true } }}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
