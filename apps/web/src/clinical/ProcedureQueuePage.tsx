import { useState } from 'react';
import { Button, Card, Col, Row, Select, Space, Statistic, Table, Tabs, Tag, Typography, message } from 'antd';
import dayjs from 'dayjs';
import { useClinics } from '../core/hooks/useClinics';
import { useCompleteProcedure, useProcedureQueue } from './hooks/useProcedureQueue';
import { OrderService, OrderServiceStatus } from './types';
import { ApiError } from '../core/api-client';

const { Title } = Typography;

const STATUS_COLOR: Record<OrderServiceStatus, string> = {
  PENDING: 'gold',
  IN_PROGRESS: 'blue',
  COMPLETED: 'green',
  CANCELLED: 'default',
};

type StatusFilter = 'All' | OrderServiceStatus;

const SUMMARY_CARDS: { key: StatusFilter; label: string }[] = [
  { key: 'All', label: 'All Procedures' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'IN_PROGRESS', label: 'In Progress' },
  { key: 'COMPLETED', label: 'Completed' },
  { key: 'CANCELLED', label: 'Cancelled' },
];

// The standalone Procedure Task Queue (docs/PRODUCT_REQUIREMENTS.md §4) —
// TASK_ORDER-only, generated automatically when a doctor adds a procedure
// via Orders & Services (Clinical 2c plan, judgment call #1). "Complete" is
// the only action, matching the audited kuwick.com reference exactly
// (D-023 precedent) — Start/Cancel live on the per-visit Orders & Services
// tab instead.
export function ProcedureQueuePage() {
  const [clinicId, setClinicId] = useState<string>();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const { data: clinics } = useClinics();
  const { data: allOrders, isLoading } = useProcedureQueue({ clinicId });
  const completeProcedure = useCompleteProcedure();

  const counts: Record<StatusFilter, number> = {
    All: allOrders?.length ?? 0,
    PENDING: allOrders?.filter((o) => o.status === 'PENDING').length ?? 0,
    IN_PROGRESS: allOrders?.filter((o) => o.status === 'IN_PROGRESS').length ?? 0,
    COMPLETED: allOrders?.filter((o) => o.status === 'COMPLETED').length ?? 0,
    CANCELLED: allOrders?.filter((o) => o.status === 'CANCELLED').length ?? 0,
  };

  const filtered = statusFilter === 'All' ? allOrders : allOrders?.filter((o) => o.status === statusFilter);

  const handleComplete = (id: string) => {
    completeProcedure
      .mutateAsync({ id })
      .catch((error) => message.error(error instanceof ApiError ? error.message : 'Failed to complete'));
  };

  return (
    <>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Title level={4} style={{ margin: 0 }}>
          Procedure Task Queue
        </Title>
        <Select
          allowClear
          placeholder="Select clinic"
          style={{ width: 220 }}
          value={clinicId}
          onChange={setClinicId}
          options={clinics?.map((clinic) => ({ value: clinic.id, label: clinic.name }))}
        />
      </Space>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        {SUMMARY_CARDS.map((card) => (
          <Col span={24 / SUMMARY_CARDS.length} key={card.key}>
            <Card
              hoverable
              size="small"
              onClick={() => setStatusFilter(card.key)}
              style={statusFilter === card.key ? { borderColor: '#1677ff' } : undefined}
            >
              <Statistic title={card.label} value={counts[card.key]} />
            </Card>
          </Col>
        ))}
      </Row>

      <Tabs
        activeKey={statusFilter}
        onChange={(key) => setStatusFilter(key as StatusFilter)}
        items={[
          { key: 'All', label: `All Statuses ${counts.All}` },
          { key: 'PENDING', label: `Pending ${counts.PENDING}` },
          { key: 'IN_PROGRESS', label: `In Progress ${counts.IN_PROGRESS}` },
          { key: 'COMPLETED', label: `Completed ${counts.COMPLETED}` },
          { key: 'CANCELLED', label: `Cancelled ${counts.CANCELLED}` },
        ]}
      />

      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={filtered}
        columns={[
          { title: 'No.', render: (_: unknown, __: OrderService, index: number) => index + 1 },
          { title: 'Code', render: (_: unknown, r: OrderService) => r.code ?? '—' },
          {
            title: 'Procedure',
            render: (_: unknown, r: OrderService) => (
              <>
                <div>{r.procedureName}</div>
                {r.instruction && <div style={{ fontSize: 12, opacity: 0.65 }}>{r.instruction}</div>}
              </>
            ),
          },
          { title: 'ID No', render: (_: unknown, r: OrderService) => r.visit?.patient?.identifierValue ?? '—' },
          { title: 'Visit No.', render: (_: unknown, r: OrderService) => r.visit?.visitNumber ?? '—' },
          { title: 'Patient', render: (_: unknown, r: OrderService) => r.visit?.patient?.name ?? 'Unknown' },
          { title: 'Requested By', render: (_: unknown, r: OrderService) => r.requestedBy?.fullName ?? '—' },
          {
            title: 'Requested At',
            render: (_: unknown, r: OrderService) => dayjs(r.requestedAt).format('YYYY-MM-DD HH:mm'),
          },
          {
            title: 'Status',
            render: (_: unknown, r: OrderService) => <Tag color={STATUS_COLOR[r.status]}>{r.status}</Tag>,
          },
          {
            title: 'Action',
            render: (_: unknown, r: OrderService) =>
              r.status === 'IN_PROGRESS' ? (
                <Button size="small" onClick={() => handleComplete(r.id)}>
                  Complete
                </Button>
              ) : null,
          },
        ]}
      />
    </>
  );
}
