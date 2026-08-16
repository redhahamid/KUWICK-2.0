import { useState } from 'react';
import { Button, Popconfirm, Select, Space, Tag, Typography, message } from 'antd';
import { MoreOutlined, PaperClipOutlined } from '@ant-design/icons';
import {
  useCancelOrderService,
  useCompleteOrderService,
  useOrderServices,
  useStartOrderService,
} from '../hooks/useOrderServices';
import { CompleteOrderModal } from '../CompleteOrderModal';
import { OrderService, OrderServiceStatus, Service } from '../types';
import { ApiError } from '../../core/api-client';
import { RailPanel } from './RailPanel';
import { AddOrderModal } from '../orders/AddOrderModal';
import { OrderSearchBox } from '../orders/OrderSearchBox';
import { orderTypeLabel } from '../orders/orderPicker';

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
  /** The visit's clinic — the room dropdown is scoped to its stations. */
  clinicId?: string;
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
export function OrdersRail({ visitId, clinicId }: OrdersRailProps) {
  const [activeOrder, setActiveOrder] = useState<OrderService | null>(null);

  // b2 PHASE E — the service chosen in the search box. Its presence IS the
  // modal being open, so the two cannot disagree about which service is being
  // ordered.
  const [picked, setPicked] = useState<Service | undefined>();
  const [focusSignal, setFocusSignal] = useState(0);
  // BOTH order types. The picker offers tasks and standard services alike and
  // tags each, so the list has to show what it let the doctor add — filtering
  // to TASK_ORDER here would make a service added from this box vanish.
  const { data: orders, isLoading, error } = useOrderServices(visitId);
  const startOrder = useStartOrderService(visitId);
  const completeOrder = useCompleteOrderService(visitId);
  const cancelOrder = useCancelOrderService(visitId);

  const report = (err: unknown, fallback: string) =>
    message.error(err instanceof ApiError ? err.message : fallback);

  const list = [...(orders ?? [])].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);
  const outstanding = list.filter((o) => o.status === 'PENDING' || o.status === 'IN_PROGRESS').length;

  return (
    <>
      <RailPanel
        title="Orders / Procedures"
        anchorId="kw-anchor-orders"
        count={list.length}
        status={outstanding > 0 ? <Tag className="kw-chip-pending">{outstanding} awaiting result</Tag> : undefined}
        isLoading={isLoading}
        error={error ?? undefined}
        // Says where the OTHER thing lives. The two cards are separate on
        // purpose, and an empty card that does not name the boundary is how a
        // doctor ends up hunting for the consultation fee in here.
        emptyText="No tests, imaging or procedures ordered. Billable services are added in Direct Services below."
        previewLimit={5}
        addControl={
          /* b2 PHASE E — the BOX, not a button in front of one.
             "+ Add Order" revealed a picker and decided nothing, which is the
             same door b1 removed from prescribing. Typing is the first act,
             and the server matches name, code and category. */
          <OrderSearchBox onPick={setPicked} focusSignal={focusSignal} />
        }
        items={list.map((order) => (
          <div key={order.id} className="kw-rail-row">
            <div className="kw-rail-row-main">
              <Space size={4} wrap>
                <Text strong style={{ fontSize: 14 }}>
                  {order.procedureName}
                </Text>
                {/* TASK or SERVICE. The most consequential fact on the row:
                    one puts work in somebody's queue and comes back with a
                    result, the other is billed and finished. */}
                <Tag className={order.orderType === 'TASK_ORDER' ? 'kw-chip-clinical' : 'kw-chip-neutral'}>
                  {orderTypeLabel(order.orderType)}
                </Tag>
                {/* A word, never colour alone. */}
                <Tag className={STATUS_CHIP[order.status]}>{STATUS_LABEL[order.status]}</Tag>
                {order.quantity > 1 && <Tag>{order.quantity} ×</Tag>}
                {order.room?.name && <Tag>{order.room.name}</Tag>}
                {order.urgency === 'URGENT' && <Tag className="kw-chip-pending">URGENT</Tag>}
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

      <AddOrderModal
        open={Boolean(picked)}
        visitId={visitId}
        clinicId={clinicId}
        service={picked}
        onClose={() => setPicked(undefined)}
        // Back to the box, so the next order starts by typing rather than by
        // aiming — the same hand-off the medications rail makes.
        onAddAnother={() => {
          setPicked(undefined);
          setFocusSignal((n) => n + 1);
        }}
      />

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
