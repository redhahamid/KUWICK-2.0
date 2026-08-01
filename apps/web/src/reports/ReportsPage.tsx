import { useMemo, useState } from 'react';
import { Card, Col, Row, Select, Space, Table, Tag, Typography, Empty } from 'antd';
import {
  DollarOutlined,
  TeamOutlined,
  ClockCircleOutlined,
  FileExclamationOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import { useClinicFilter } from '../core/hooks/useClinicFilter';
import { OutstandingClaimBatch } from '../clinical/types';
import {
  useAppointmentAnalytics,
  useDoctorPerformance,
  useReportsPanelAging,
  useSalesAnalysis,
  useSalesSummary,
  useWaitTimes,
} from './hooks/useReports';
import { ReportRangeBar, ReportRange, defaultRange, previousRange } from './ReportRangeBar';
import { KpiTile } from './charts/KpiTile';
import { TrendChart } from './charts/TrendChart';
import { DonutChart } from './charts/DonutChart';
import { Leaderboard } from './charts/Leaderboard';
import { INK, SERIES, SERIES_ORDER, formatRM, formatRMCompact } from './charts/tokens';

const { Title, Text } = Typography;

const BATCH_STATUS_COLOR: Record<string, string> = {
  SUBMITTED: 'blue',
  PARTIALLY_PAID: 'gold',
  PAID: 'green',
};

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

// Executive Dashboard, redesigned 2026-08-01 against real KUWICK data —
// every figure below reads from the same /reports/* endpoints as the rest
// of the report suite, none are illustrative. See
// docs/PROPOSED_ADDENDUM_2026-08-01_klinik-hijraa-admin-reference.md for
// the design reference this follows.
export function ReportsPage() {
  const { clinicId, setClinicId, clinics, showSelector } = useClinicFilter();
  const [range, setRange] = useState<ReportRange>(defaultRange(30));
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const prev = useMemo(() => previousRange(range), [range]);

  const params = { from: range.from, to: range.to, clinicId };
  const prevParams = { from: prev.from, to: prev.to, clinicId };

  const { data: sales, isLoading: salesLoading } = useSalesSummary(params);
  const { data: prevSales } = useSalesSummary(prevParams);
  const { data: salesAnalysis, isLoading: analysisLoading } = useSalesAnalysis(params);
  const { data: prevSalesAnalysis } = useSalesAnalysis(prevParams);
  const { data: appointments, isLoading: appointmentsLoading } = useAppointmentAnalytics(params);
  const { data: prevAppointments } = useAppointmentAnalytics(prevParams);
  const { data: waitTimes, isLoading: waitLoading } = useWaitTimes(params);
  const { data: prevWaitTimes } = useWaitTimes(prevParams);
  const { data: doctors, isLoading: doctorsLoading } = useDoctorPerformance(params);
  const { data: outstanding, isLoading: outstandingLoading } = useReportsPanelAging();

  const patientsSeen = (salesAnalysis?.byDay ?? []).reduce((sum, d) => sum + d.patients, 0);
  const prevPatientsSeen = (prevSalesAnalysis?.byDay ?? []).reduce((sum, d) => sum + d.patients, 0);
  const panelOutstanding = (outstanding ?? []).reduce((sum, b) => sum + b.outstandingAmount, 0);

  const revenueTrendDates = (sales?.byDay ?? []).map((d) => d.date);
  const waitTrendDates = (waitTimes?.byDay ?? []).map((d) => d.date);

  const categorySegments = (salesAnalysis?.byCategory ?? []).map((c, i) => ({
    key: c.category,
    label: c.category,
    color: SERIES_ORDER[i % SERIES_ORDER.length],
    value: c.amount,
  }));

  const activeCategoryAmount = categorySegments.find((c) => c.key === activeCategory);
  const categoryTotal = categorySegments.reduce((sum, c) => sum + c.value, 0);

  const leaderboardRows = (doctors ?? []).map((d) => ({
    id: d.staffId,
    name: d.staffName,
    value: d.revenue,
    secondaryLabel: 'patients',
    secondaryValue: d.visitCount,
    revenuePerVisit: d.revenuePerVisit,
  }));

  const appointmentStatusRows = Object.entries(appointments?.countByStatus ?? {}).filter(([, count]) => count > 0);
  const appointmentStatusMax = Math.max(...appointmentStatusRows.map(([, c]) => c), 1);

  return (
    <div style={{ paddingTop: 24, paddingBottom: 32 }}>
      <Space style={{ marginBottom: 4, width: '100%', justifyContent: 'space-between' }} wrap align="start">
        <div>
          <Title level={4} style={{ margin: 0 }}>
            Executive Dashboard
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            Revenue, patients, doctor performance and wait times for the selected range
          </Text>
        </div>
        <Space wrap>
          <ReportRangeBar value={range} onChange={setRange} />
          {showSelector && (
            <Select
              allowClear
              style={{ width: 180 }}
              placeholder="All clinics"
              value={clinicId}
              onChange={setClinicId}
              options={clinics?.map((clinic) => ({ value: clinic.id, label: clinic.name }))}
            />
          )}
        </Space>
      </Space>

      <Row gutter={[12, 12]} style={{ marginTop: 20, marginBottom: 4 }}>
        <Col xs={24} sm={12} lg={8} xl={24 / 5}>
          <KpiTile
            label="Total Revenue"
            value={formatRM(sales?.totalRevenue ?? 0)}
            icon={<DollarOutlined />}
            loading={salesLoading}
            deltaPercent={sales && prevSales ? pctChange(sales.totalRevenue, prevSales.totalRevenue) : null}
            subtitle="vs last period"
            sparkline={(sales?.byDay ?? []).map((d) => d.cash + d.panel)}
          />
        </Col>
        <Col xs={24} sm={12} lg={8} xl={24 / 5}>
          <KpiTile
            label="Patients Seen"
            value={patientsSeen.toLocaleString()}
            icon={<TeamOutlined />}
            loading={analysisLoading}
            deltaPercent={pctChange(patientsSeen, prevPatientsSeen)}
            subtitle="vs last period"
            sparkline={(salesAnalysis?.byDay ?? []).map((d) => d.patients)}
          />
        </Col>
        <Col xs={24} sm={12} lg={8} xl={24 / 5}>
          <KpiTile
            label="Avg Wait Time"
            value={waitTimes?.averageWaitMinutes != null ? `${waitTimes.averageWaitMinutes}m` : '—'}
            icon={<ClockCircleOutlined />}
            loading={waitLoading}
            higherIsBetter={false}
            deltaPercent={
              waitTimes?.averageWaitMinutes != null && prevWaitTimes?.averageWaitMinutes != null
                ? pctChange(waitTimes.averageWaitMinutes, prevWaitTimes.averageWaitMinutes)
                : null
            }
            subtitle="vs last period"
            sparkline={(waitTimes?.byDay ?? []).map((d) => d.averageWaitMinutes ?? 0)}
          />
        </Col>
        <Col xs={24} sm={12} lg={8} xl={24 / 5}>
          <KpiTile
            label="Completed Rate"
            value={`${appointments?.completedRate ?? 0}%`}
            icon={<CheckCircleOutlined />}
            loading={appointmentsLoading}
            deltaPercent={
              appointments && prevAppointments ? pctChange(appointments.completedRate, prevAppointments.completedRate) : null
            }
            subtitle="vs last period"
          />
        </Col>
        <Col xs={24} sm={12} lg={8} xl={24 / 5}>
          <KpiTile
            label="Panel Outstanding"
            value={formatRM(panelOutstanding)}
            icon={<FileExclamationOutlined />}
            loading={outstandingLoading}
            subtitle="as of today, all clinics"
          />
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 4 }}>
        <Col xs={24} xl={14}>
          <Card
            size="small"
            title="Revenue Trend"
            extra={<Text type="secondary" style={{ fontSize: 12 }}>Cash vs Panel</Text>}
            loading={salesLoading}
          >
            <TrendChart
              dates={revenueTrendDates}
              valueFormatter={(v) => formatRMCompact(v)}
              series={[
                { key: 'cash', label: 'Cash Collected', color: SERIES.blue, area: true, values: (sales?.byDay ?? []).map((d) => d.cash) },
                { key: 'panel', label: 'Panel Owed', color: SERIES.orange, area: true, values: (sales?.byDay ?? []).map((d) => d.panel) },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card
            size="small"
            title="Revenue by Category"
            extra={
              activeCategory && (
                <Text type="secondary" style={{ fontSize: 12, cursor: 'pointer' }} onClick={() => setActiveCategory(null)}>
                  Clear
                </Text>
              )
            }
            loading={analysisLoading}
          >
            <DonutChart
              segments={categorySegments}
              centerLabel="Total"
              valueFormatter={(v) => formatRM(v)}
              activeKey={activeCategory}
              onSegmentClick={(key) => setActiveCategory((current) => (current === key ? null : key))}
            />
            {activeCategoryAmount && (
              <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 10 }}>
                {activeCategoryAmount.label}: {formatRM(activeCategoryAmount.value)} —{' '}
                {categoryTotal > 0 ? ((activeCategoryAmount.value / categoryTotal) * 100).toFixed(0) : 0}% of revenue in this
                range
              </Text>
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col span={24}>
          <Card size="small" title="Doctor Performance" loading={doctorsLoading}>
            <Leaderboard
              rows={leaderboardRows}
              valueFormatter={(v) => formatRM(v)}
              renderDetail={(row) => <span>Revenue per patient: {formatRM(row.revenuePerVisit)}</span>}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} xl={14}>
          <Card
            size="small"
            title="Waiting & Consultation Time"
            extra={<Text type="secondary" style={{ fontSize: 12 }}>Minutes, by day</Text>}
            loading={waitLoading}
          >
            <TrendChart
              dates={waitTrendDates}
              valueFormatter={(v) => `${v.toFixed(0)}m`}
              series={[
                { key: 'wait', label: 'Waiting', color: SERIES.aqua, values: (waitTimes?.byDay ?? []).map((d) => d.averageWaitMinutes) },
                {
                  key: 'service',
                  label: 'Consultation + Dispensary',
                  color: SERIES.violet,
                  values: (waitTimes?.byDay ?? []).map((d) => d.averageServiceMinutes),
                },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card size="small" title="Appointments by Status" loading={appointmentsLoading}>
            {appointmentStatusRows.length === 0 ? (
              <Empty description="No appointments in this range yet" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: '24px 0' }} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {appointmentStatusRows.map(([status, count], i) => (
                  <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 100, fontSize: 12, color: INK.secondary, flexShrink: 0 }}>{status}</span>
                    <div style={{ flex: 1, background: INK.gridline, borderRadius: 3, height: 10, overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${(count / appointmentStatusMax) * 100}%`,
                          background: SERIES_ORDER[i % SERIES_ORDER.length],
                          height: '100%',
                          borderRadius: 3,
                        }}
                      />
                    </div>
                    <strong style={{ width: 36, textAlign: 'right', fontSize: 13, color: INK.primary }}>{count}</strong>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col span={24}>
          <Card size="small" title="Panel Claims Outstanding">
            <Table
              size="small"
              rowKey="id"
              loading={outstandingLoading}
              dataSource={outstanding}
              pagination={{ pageSize: 8, hideOnSinglePage: true }}
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
          </Card>
        </Col>
      </Row>
    </div>
  );
}
