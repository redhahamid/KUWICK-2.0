import { useState } from 'react';
import { Badge, Button, Card, Empty, Input, Popconfirm, Select, Space, Table, Tabs, Tag, Typography, message } from 'antd';
import { MedicineBoxOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useServices } from './hooks/useServices';
import {
  useCancelOrderService,
  useCompleteOrderService,
  useCreateOrderService,
  useOrderServices,
  useStartOrderService,
} from './hooks/useOrderServices';
import { OrderService, OrderServiceStatus } from './types';
import { ApiError } from '../core/api-client';

const { Text } = Typography;

const STATUS_COLOR: Record<OrderServiceStatus, string> = {
  PENDING: 'gold',
  IN_PROGRESS: 'blue',
  COMPLETED: 'green',
  CANCELLED: 'default',
};

type StatusFilter = 'All' | OrderServiceStatus;

interface OrdersServicesTabProps {
  visitId: string;
}

export function OrdersServicesTab({ visitId }: OrdersServicesTabProps) {
  const [serviceCatalogId, setServiceCatalogId] = useState<string>();
  const [instruction, setInstruction] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');

  const { data: services } = useServices();
  const { data: allOrders, isLoading } = useOrderServices(visitId);
  const createOrder = useCreateOrderService(visitId);
  const startOrder = useStartOrderService(visitId);
  const completeOrder = useCompleteOrderService(visitId);
  const cancelOrder = useCancelOrderService(visitId);

  const reportFailure = (error: unknown, fallback: string) => {
    message.error(error instanceof ApiError ? error.message : fallback);
  };

  const handleAdd = async () => {
    if (!serviceCatalogId) return;
    try {
      await createOrder.mutateAsync({ visitId, serviceCatalogId, instruction: instruction || undefined });
      setServiceCatalogId(undefined);
      setInstruction('');
    } catch (error) {
      reportFailure(error, 'Failed to add order/service');
    }
  };

  const taskOrderCount = allOrders?.filter((o) => o.orderType === 'TASK_ORDER').length ?? 0;
  const standardServiceCount = allOrders?.filter((o) => o.orderType === 'STANDARD_SERVICE').length ?? 0;

  const statusCounts: Record<StatusFilter, number> = {
    All: allOrders?.length ?? 0,
    PENDING: allOrders?.filter((o) => o.status === 'PENDING').length ?? 0,
    IN_PROGRESS: allOrders?.filter((o) => o.status === 'IN_PROGRESS').length ?? 0,
    COMPLETED: allOrders?.filter((o) => o.status === 'COMPLETED').length ?? 0,
    CANCELLED: allOrders?.filter((o) => o.status === 'CANCELLED').length ?? 0,
  };

  const orders = statusFilter === 'All' ? allOrders : allOrders?.filter((o) => o.status === statusFilter);

  return (
    <div>
      <Card
        size="small"
        title={
          <Space>
            <MedicineBoxOutlined /> Add Order or Service
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <Text type="secondary">Select Order / Service</Text>
        <Select
          showSearch
          allowClear
          style={{ width: '100%', marginTop: 4, marginBottom: 12 }}
          placeholder="Search orders or services..."
          value={serviceCatalogId}
          onChange={setServiceCatalogId}
          filterOption={(input, option) => (option?.label as string).toLowerCase().includes(input.toLowerCase())}
          options={services?.map((service) => ({
            value: service.id,
            label: service.code ? `${service.code} — ${service.name}` : service.name,
          }))}
        />
        <Input
          style={{ marginBottom: 12 }}
          placeholder="Instruction (optional)"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
        />
        <div style={{ textAlign: 'right' }}>
          <Button type="primary" loading={createOrder.isPending} disabled={!serviceCatalogId} onClick={handleAdd}>
            + Add Order / Service
          </Button>
        </div>
      </Card>

      <Card
        size="small"
        title="Orders & Services List"
        extra={
          <Space>
            <Badge color="purple" text={`Task Orders (${taskOrderCount})`} />
            <Badge color="green" text={`Standard Services (${standardServiceCount})`} />
          </Space>
        }
      >
        <Tabs
          activeKey={statusFilter}
          onChange={(key) => setStatusFilter(key as StatusFilter)}
          items={[
            { key: 'All', label: `All ${statusCounts.All}` },
            { key: 'PENDING', label: `Pending ${statusCounts.PENDING}` },
            { key: 'IN_PROGRESS', label: `In Progress ${statusCounts.IN_PROGRESS}` },
            { key: 'COMPLETED', label: `Completed ${statusCounts.COMPLETED}` },
            { key: 'CANCELLED', label: `Cancelled ${statusCounts.CANCELLED}` },
          ]}
        />

        {!isLoading && (!orders || orders.length === 0) ? (
          <Empty image={<SafetyCertificateOutlined style={{ fontSize: 40, opacity: 0.3 }} />} description="No procedures found in this status" />
        ) : (
          <Table
            rowKey="id"
            loading={isLoading}
            dataSource={orders}
            columns={[
              { title: 'No.', render: (_: unknown, __: OrderService, index: number) => index + 1 },
              { title: 'Code', render: (_: unknown, r: OrderService) => r.code ?? '—' },
              { title: 'Procedure', dataIndex: 'procedureName' },
              { title: 'Instruction', render: (_: unknown, r: OrderService) => r.instruction ?? '—' },
              { title: 'Result', render: (_: unknown, r: OrderService) => r.result ?? '—' },
              {
                title: 'Date & Time',
                render: (_: unknown, r: OrderService) => dayjs(r.requestedAt).format('YYYY-MM-DD HH:mm'),
              },
              {
                title: 'Status',
                render: (_: unknown, r: OrderService) => <Tag color={STATUS_COLOR[r.status]}>{r.status}</Tag>,
              },
              {
                title: 'Action',
                render: (_: unknown, r: OrderService) => (
                  <Space>
                    {r.status === 'PENDING' && (
                      <Button
                        size="small"
                        onClick={() =>
                          startOrder.mutateAsync({ id: r.id }).catch((e) => reportFailure(e, 'Failed to start'))
                        }
                      >
                        Start
                      </Button>
                    )}
                    {r.status === 'IN_PROGRESS' && (
                      <Button
                        size="small"
                        onClick={() =>
                          completeOrder.mutateAsync({ id: r.id }).catch((e) => reportFailure(e, 'Failed to complete'))
                        }
                      >
                        Complete
                      </Button>
                    )}
                    {(r.status === 'PENDING' || r.status === 'IN_PROGRESS') && (
                      <Popconfirm
                        title="Cancel this order/service?"
                        onConfirm={() =>
                          cancelOrder.mutateAsync({ id: r.id }).catch((e) => reportFailure(e, 'Failed to cancel'))
                        }
                      >
                        <Button size="small" danger>
                          Cancel
                        </Button>
                      </Popconfirm>
                    )}
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
