import { useState } from 'react';
import { Button, Card, Col, Popconfirm, Row, Select, Space, Statistic, Table, Tabs, Tag, Typography, message } from 'antd';
import { CheckOutlined, PaperClipOutlined, PrinterOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useClinicFilter } from '../core/hooks/useClinicFilter';
import { useAcceptProcedure, useCancelProcedure, useCompleteProcedure, useProcedureQueue } from './hooks/useProcedureQueue';
import { CompleteOrderModal } from './CompleteOrderModal';
import { OrderService, OrderServiceStatus } from './types';
import { ApiError } from '../core/api-client';
import { PageHeader } from '../design-system/components/PageHeader';

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
// via Orders & Services (Clinical 2c plan, judgment call #1). Full
// lifecycle lives here now (owner feedback: staff work this queue
// directly, not the per-visit Orders & Services tab) — Accept moves
// PENDING -> IN_PROGRESS, Complete records the result/attachments,
// Cancel is available before completion, and Print opens a formatted
// result view once done.
export function ProcedureQueuePage() {
  const { clinicId, setClinicId, clinics, showSelector } = useClinicFilter();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [activeOrder, setActiveOrder] = useState<OrderService | null>(null);
  const { data: allOrders, isLoading } = useProcedureQueue({ clinicId });
  const acceptProcedure = useAcceptProcedure();
  const cancelProcedure = useCancelProcedure();
  const completeProcedure = useCompleteProcedure();

  const counts: Record<StatusFilter, number> = {
    All: allOrders?.length ?? 0,
    PENDING: allOrders?.filter((o) => o.status === 'PENDING').length ?? 0,
    IN_PROGRESS: allOrders?.filter((o) => o.status === 'IN_PROGRESS').length ?? 0,
    COMPLETED: allOrders?.filter((o) => o.status === 'COMPLETED').length ?? 0,
    CANCELLED: allOrders?.filter((o) => o.status === 'CANCELLED').length ?? 0,
  };

  const filtered = statusFilter === 'All' ? allOrders : allOrders?.filter((o) => o.status === statusFilter);

  const handleComplete = async (
    id: string,
    result: string,
    formTemplateId?: string,
    formData?: Record<string, unknown>,
  ) => {
    await completeProcedure.mutateAsync({ id, input: { result: result || undefined, formTemplateId, formData } });
  };

  const handleAccept = (id: string) => {
    acceptProcedure.mutateAsync({ id }).catch((e) => message.error(e instanceof ApiError ? e.message : 'Failed to accept'));
  };

  const handleCancel = (id: string) => {
    cancelProcedure.mutateAsync({ id }).catch((e) => message.error(e instanceof ApiError ? e.message : 'Failed to cancel'));
  };

  const handlePrint = (id: string) => {
    window.open(`/print/order-service/${id}`, '_blank');
  };

  return (
    <>
      <PageHeader
        title="Procedure Task Queue"
        extra={
          <>
            {showSelector && (
          <Select
            allowClear
            placeholder="Select clinic"
            style={{ width: 220 }}
            value={clinicId}
            onChange={setClinicId}
            options={clinics?.map((clinic) => ({ value: clinic.id, label: clinic.name }))}
          />
        )}
          </>
        }
      />

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
            render: (_: unknown, r: OrderService) => {
              if (r.status === 'PENDING') {
                return (
                  <Space>
                    <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => handleAccept(r.id)}>
                      Accept
                    </Button>
                    <Popconfirm title="Cancel this task?" onConfirm={() => handleCancel(r.id)}>
                      <Button size="small" danger>
                        Cancel
                      </Button>
                    </Popconfirm>
                  </Space>
                );
              }
              if (r.status === 'IN_PROGRESS') {
                return (
                  <Space>
                    <Button size="small" onClick={() => setActiveOrder(r)}>
                      Complete
                    </Button>
                    <Popconfirm title="Cancel this task?" onConfirm={() => handleCancel(r.id)}>
                      <Button size="small" danger>
                        Cancel
                      </Button>
                    </Popconfirm>
                  </Space>
                );
              }
              if (r.status === 'COMPLETED') {
                return (
                  <Space>
                    <Button size="small" type="text" icon={<PaperClipOutlined />} onClick={() => setActiveOrder(r)}>
                      Attachments
                    </Button>
                    <Button size="small" type="text" icon={<PrinterOutlined />} onClick={() => handlePrint(r.id)}>
                      Print
                    </Button>
                  </Space>
                );
              }
              return null;
            },
          },
        ]}
      />
      <CompleteOrderModal
        order={activeOrder}
        onClose={() => setActiveOrder(null)}
        onComplete={handleComplete}
        completing={completeProcedure.isPending}
      />
    </>
  );
}
