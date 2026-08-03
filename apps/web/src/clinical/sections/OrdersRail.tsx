import { useState } from 'react';
import { Button, Popconfirm, Select, Space, Tag, Typography, message } from 'antd';
import { MoreOutlined, PaperClipOutlined } from '@ant-design/icons';
import { useServices } from '../hooks/useServices';
import {
  useCancelOrderService,
  useCompleteOrderService,
  useCreateOrderService,
  useOrderServices,
  useStartOrderService,
} from '../hooks/useOrderServices';
import { CompleteOrderModal } from '../CompleteOrderModal';
import { OrderService, OrderServiceStatus } from '../types';
import { ApiError } from '../../core/api-client';
import { RailPanel } from './RailPanel';

const { Text } = Typography;

// Human labels for the REAL statuses. The enum is unchanged and nothing here
// invents an approval state.
const STATUS_LABEL: Record<OrderServiceStatus, string> = {
  PENDING: 'Ordered',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

// Token colour PAIRS. The label is always rendered too — status is never
// carried by colour alone (D-077 §4).
const STATUS_CHIP: Record<OrderServiceStatus, string> = {
  PENDING: 'kw-chip-pending',
  IN_PROGRESS: 'kw-chip-progress',
  COMPLETED: 'kw-chip-success',
  CANCELLED: 'kw-chip-neutral',
};

// Outstanding work first: what still needs doing is why a doctor looks.
const STATUS_RANK: Record<OrderServiceStatus, number> = {
  IN_PROGRESS: 0,
  PENDING: 1,
  COMPLETED: 2,
  CANCELLED: 3,
};

interface OrdersRailProps {
  visitId: string;
}

/**
 * G4.5c (D-071) — Orders / Procedures, always open in the rail.
 *
 * `orderType = TASK_ORDER` only: investigations and procedures that someone
 * has to carry out. Direct services are their own panel, because a
 * consultation fee has no lab to run it.
 *
 * Pending work is visible without a click and sorted to the top, and each
 * row shows only the action its status actually permits — the same rule the
 * expanded section used. Completion, result forms, attachments and per-order
 * chat all remain the unchanged `CompleteOrderModal`.
 */
export function OrdersRail({ visitId }: OrdersRailProps) {
  const [serviceCatalogId, setServiceCatalogId] = useState<string>();
  const [activeOrder, setActiveOrder] = useState<OrderService | null>(null);

  const { data: services } = useServices();
  const { data: orders, isLoading, error } = useOrderServices(visitId, { orderType: 'TASK_ORDER' });
  const createOrder = useCreateOrderService(visitId);
  const startOrder = useStartOrderService(visitId);
  const completeOrder = useCompleteOrderService(visitId);
  const cancelOrder = useCancelOrderService(visitId);

  const report = (err: unknown, fallback: string) =>
    message.error(err instanceof ApiError ? err.message : fallback);

  const list = [...(orders ?? [])].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);
  const outstanding = list.filter((o) => o.status === 'PENDING' || o.status === 'IN_PROGRESS').length;

  const add = async () => {
    if (!serviceCatalogId) return;
    try {
      await createOrder.mutateAsync({ visitId, serviceCatalogId });
      setServiceCatalogId(undefined);
    } catch (err) {
      report(err, 'Failed to add the order');
    }
  };

  // Only TASK_ORDER catalogue entries can be ordered here.
  const orderable = (services ?? []).filter((service) => service.orderType === 'TASK_ORDER');

  return (
    <>
      <RailPanel
        title="Orders / Procedures"
        anchorId="kw-anchor-orders"
        count={list.length}
        status={outstanding > 0 ? <Tag className="kw-chip-pending">{outstanding} awaiting result</Tag> : undefined}
        isLoading={isLoading}
        error={error ?? undefined}
        emptyText="No orders or procedures for this visit"
        previewLimit={4}
        addControl={
          <Space.Compact style={{ width: '100%' }}>
            <Select
              showSearch
              allowClear
              style={{ width: '100%' }}
              placeholder="Search investigations or procedures…"
              value={serviceCatalogId}
              onChange={setServiceCatalogId}
              filterOption={(input, option) => (option?.label as string).toLowerCase().includes(input.toLowerCase())}
              options={orderable.map((service) => ({
                value: service.id,
                label: service.code ? `${service.code} — ${service.name}` : service.name,
              }))}
            />
            <Button type="primary" loading={createOrder.isPending} disabled={!serviceCatalogId} onClick={add}>
              Add Order
            </Button>
          </Space.Compact>
        }
        items={list.map((order) => (
          <div key={order.id} className="kw-rail-row">
            <div className="kw-rail-row-main">
              <Space size={4} wrap>
                <Text strong style={{ fontSize: 14 }}>
                  {order.procedureName}
                </Text>
                {/* A word, never colour alone. */}
                <Tag className={STATUS_CHIP[order.status]}>{STATUS_LABEL[order.status]}</Tag>
                {(order._count?.attachments ?? 0) > 0 && (
                  <Tag icon={<PaperClipOutlined />}>{order._count!.attachments}</Tag>
                )}
                {(order._count?.invoiceLines ?? 0) > 0 && <Tag className="kw-chip-clinical">On invoice</Tag>}
              </Space>
              {order.result && (
                <Text style={{ fontSize: 12 }} ellipsis>
                  Result: {order.result}
                </Text>
              )}
              {order.cancelReason && (
                <Text type="danger" style={{ fontSize: 12 }}>
                  Cancelled: {order.cancelReason}
                </Text>
              )}
            </div>

            {/* Only the action this status permits — nothing greyed out. */}
            <Space size={4} className="kw-rail-row-actions">
              {order.status === 'PENDING' && (
                <Button
                  size="small"
                  type="primary"
                  loading={startOrder.isPending}
                  onClick={() => startOrder.mutateAsync({ id: order.id }).catch((e) => report(e, 'Failed to start'))}
                >
                  Start
                </Button>
              )}
              {order.status === 'IN_PROGRESS' && (
                <Button size="small" type="primary" onClick={() => setActiveOrder(order)}>
                  Complete
                </Button>
              )}
              {order.status === 'COMPLETED' && (
                <Button size="small" onClick={() => setActiveOrder(order)}>
                  View Result
                </Button>
              )}
              {/* D-077 — Cancel moves into More. The confirmation step is
                  kept: it is now the menu item's own Popconfirm, so nothing
                  can be cancelled in a single unguarded click. */}
              {(order.status === 'PENDING' || order.status === 'IN_PROGRESS') && (
                <Popconfirm
                  title="Cancel this order?"
                  okText="Cancel order"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => cancelOrder.mutateAsync({ id: order.id }).catch((e) => report(e, 'Failed to cancel'))}
                >
                  <Button size="small" icon={<MoreOutlined />} aria-label={`Cancel ${order.procedureName}`} />
                </Popconfirm>
              )}
            </Space>
          </div>
        ))}
      />

      {/* Unchanged: form templates, attachments and per-order chat. */}
      <CompleteOrderModal
        order={activeOrder}
        onClose={() => setActiveOrder(null)}
        onComplete={(id, result, formTemplateId, formData) =>
          completeOrder
            .mutateAsync({ id, input: { result: result || undefined, formTemplateId, formData } })
            .then(() => undefined)
        }
        completing={completeOrder.isPending}
      />
    </>
  );
}
