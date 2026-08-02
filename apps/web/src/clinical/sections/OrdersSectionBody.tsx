import { useState } from 'react';
import { Button, Input, Popconfirm, Select, Space, Tag, Typography, message } from 'antd';
import { PaperClipOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
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

const { Text } = Typography;

// G2b — display labels for the REAL statuses. The enum is unchanged; nothing
// here invents "Pending doctor approval" or "Approved", which remain a future
// business-workflow phase.
const STATUS_LABEL: Record<OrderServiceStatus, string> = {
  PENDING: 'Ordered',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

const STATUS_COLOR: Record<OrderServiceStatus, string> = {
  PENDING: 'gold',
  IN_PROGRESS: 'blue',
  COMPLETED: 'green',
  CANCELLED: 'default',
};

interface OrdersSectionBodyProps {
  visitId: string;
}

// G2b (D-060) — the expanded Orders / Procedures workspace.
//
// The old tab showed Start, Complete, Attachments and Cancel as a row of
// buttons and simply hid the ones that did not apply; in a table that read as
// a wall of controls. Here each order is a row whose NEXT action is the
// prominent one, and actions that the current status does not permit are not
// rendered at all.
//
// Every existing behaviour is reused, not reimplemented: the same hooks, the
// same CompleteOrderModal (form templates, attachments and per-order chat all
// live inside it), and the same start/complete/cancel rules.
export function OrdersSectionBody({ visitId }: OrdersSectionBodyProps) {
  const [serviceCatalogId, setServiceCatalogId] = useState<string>();
  const [instruction, setInstruction] = useState('');
  const [activeOrder, setActiveOrder] = useState<OrderService | null>(null);

  const { data: services } = useServices();
  const { data: orders, isLoading } = useOrderServices(visitId);
  const createOrder = useCreateOrderService(visitId);
  const startOrder = useStartOrderService(visitId);
  const completeOrder = useCompleteOrderService(visitId);
  const cancelOrder = useCancelOrderService(visitId);

  const report = (error: unknown, fallback: string) =>
    message.error(error instanceof ApiError ? error.message : fallback);

  const add = async () => {
    if (!serviceCatalogId) return;
    try {
      await createOrder.mutateAsync({ visitId, serviceCatalogId, instruction: instruction || undefined });
      setServiceCatalogId(undefined);
      setInstruction('');
    } catch (error) {
      report(error, 'Failed to add the order');
    }
  };

  const list = orders ?? [];

  return (
    <div>
      <Space wrap style={{ width: '100%', marginBottom: 12 }} size={8}>
        <Select
          showSearch
          allowClear
          style={{ width: '100%', maxWidth: 420 }}
          placeholder="Search orders, procedures or investigations..."
          value={serviceCatalogId}
          onChange={setServiceCatalogId}
          filterOption={(input, option) => (option?.label as string).toLowerCase().includes(input.toLowerCase())}
          options={services?.map((service) => ({
            value: service.id,
            label: service.code ? `${service.code} — ${service.name}` : service.name,
          }))}
        />
        <Input
          style={{ width: '100%', maxWidth: 320 }}
          placeholder="Instruction (optional)"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onPressEnter={add}
        />
        <Button type="primary" loading={createOrder.isPending} disabled={!serviceCatalogId} onClick={add}>
          Add Order
        </Button>
      </Space>

      {list.length === 0 && !isLoading ? (
        <Text type="secondary" italic>
          No orders or procedures for this visit.
        </Text>
      ) : (
        <div className="kw-dx-list">
          {list.map((order) => (
            <div key={order.id} className="kw-dx-row">
              <div className="kw-dx-main">
                <Space wrap size={6}>
                  {order.code && <Tag color="geekblue">{order.code}</Tag>}
                  <Text strong>{order.procedureName}</Text>
                  {/* Status carries an explicit word, never colour alone. */}
                  <Tag color={STATUS_COLOR[order.status]}>{STATUS_LABEL[order.status]}</Tag>
                  {(order._count?.attachments ?? 0) > 0 && (
                    <Tag icon={<PaperClipOutlined />}>
                      {order._count!.attachments} attached
                    </Tag>
                  )}
                  {/* Charge status only where the data genuinely supports it:
                      an invoice line linked to this order. Nothing is inferred
                      when there is none. */}
                  {(order._count?.invoiceLines ?? 0) > 0 && <Tag color="purple">On invoice</Tag>}
                </Space>

                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Ordered by {order.requestedBy?.fullName ?? 'not recorded'} ·{' '}
                    {dayjs(order.requestedAt).format('D MMM YYYY, HH:mm')}
                    {order.completedAt && ` · Completed ${dayjs(order.completedAt).format('D MMM, HH:mm')}`}
                  </Text>
                </div>

                {order.instruction && (
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Instruction: {order.instruction}
                    </Text>
                  </div>
                )}
                {order.result && (
                  <div>
                    <Text style={{ fontSize: 12 }}>Result: {order.result}</Text>
                  </div>
                )}
                {order.cancelReason && (
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Cancelled: {order.cancelReason}
                    </Text>
                  </div>
                )}
              </div>

              {/* Only the actions this status actually permits. */}
              <Space size={4} className="kw-dx-actions">
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
                    View result
                  </Button>
                )}
                {(order.status === 'PENDING' || order.status === 'IN_PROGRESS') && (
                  <Popconfirm
                    title="Cancel this order?"
                    okText="Cancel order"
                    okButtonProps={{ danger: true }}
                    onConfirm={() =>
                      cancelOrder.mutateAsync({ id: order.id }).catch((e) => report(e, 'Failed to cancel'))
                    }
                  >
                    <Button size="small" danger>
                      Cancel
                    </Button>
                  </Popconfirm>
                )}
              </Space>
            </div>
          ))}
        </div>
      )}

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
    </div>
  );
}
