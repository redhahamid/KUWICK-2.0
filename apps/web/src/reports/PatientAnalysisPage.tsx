import { useState } from 'react';
import { Card, Col, Row, Space, Statistic, Typography } from 'antd';
import { Column, Pie } from '@ant-design/plots';
import { usePatientAnalysis } from './hooks/useReports';
import { ReportRange, ReportRangeBar, defaultRange } from './ReportRangeBar';

const { Title } = Typography;

function pieConfig(data: { type: string; value: number }[]) {
  return {
    data,
    angleField: 'value',
    colorField: 'type',
    height: 240,
    label: { text: 'type', position: 'outside' as const },
    legend: { color: { position: 'bottom' as const } },
  };
}

// D-039 — the reference's PATIENT ANALYSIS DASHBOARD: new vs existing,
// panel vs non-panel, gender, age group, % by panel, attendance by hour
// (peak-visit view) and by day of week.
export function PatientAnalysisPage() {
  const [range, setRange] = useState<ReportRange>(defaultRange(30));
  const { data, isLoading } = usePatientAnalysis(range);

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }} wrap>
        <Title level={4} style={{ margin: 0 }}>
          Patient Analysis
        </Title>
        <ReportRangeBar value={range} onChange={setRange} />
      </Space>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card loading={isLoading}>
            <Statistic title="Total Visits" value={data?.totalVisits ?? 0} />
          </Card>
        </Col>
        <Col span={6}>
          <Card loading={isLoading}>
            <Statistic title="Unique Patients" value={data?.uniquePatients ?? 0} />
          </Card>
        </Col>
        <Col span={6}>
          <Card loading={isLoading}>
            <Statistic title="New / Existing" value={`${data?.newPatients ?? 0} / ${data?.existingPatients ?? 0}`} />
          </Card>
        </Col>
        <Col span={6}>
          <Card loading={isLoading}>
            <Statistic title="Panel / Cash Visits" value={`${data?.panelVisits ?? 0} / ${data?.cashVisits ?? 0}`} />
          </Card>
        </Col>
      </Row>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={12}>
          <Card title="Patient Attendance by Hour" loading={isLoading}>
            <Column data={data?.byHour ?? []} xField="hour" yField="count" height={240} />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="Total Patient Attendance by Day" loading={isLoading}>
            <Column data={data?.byDayOfWeek ?? []} xField="day" yField="count" height={240} />
          </Card>
        </Col>
      </Row>
      <Row gutter={16}>
        <Col span={6}>
          <Card title="% of Patients by Gender" loading={isLoading}>
            <Pie {...pieConfig((data?.byGender ?? []).map((g) => ({ type: g.gender, value: g.count })))} />
          </Card>
        </Col>
        <Col span={6}>
          <Card title="% of Patients by Age Group" loading={isLoading}>
            <Pie {...pieConfig((data?.byAgeGroup ?? []).map((a) => ({ type: a.ageGroup, value: a.count })))} />
          </Card>
        </Col>
        <Col span={6}>
          <Card title="% of Non-Panel & Panel Patients" loading={isLoading}>
            <Pie
              {...pieConfig([
                { type: 'Panel', value: data?.panelVisits ?? 0 },
                { type: 'Non-Panel', value: data?.cashVisits ?? 0 },
              ])}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card title="% of Patients by Panel" loading={isLoading}>
            <Pie {...pieConfig((data?.byPanel ?? []).map((p) => ({ type: p.panelName, value: p.count })))} />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
