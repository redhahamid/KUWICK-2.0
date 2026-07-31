import { Card, Empty, Popconfirm, Select, Space, Tag, Typography } from 'antd';
import { CloseOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useServices } from './hooks/useServices';
import { useCancelOrderService, useCreateOrderService, useOrderServices } from './hooks/useOrderServices';
import { OrderServiceStatus } from './types';

const { Text } = Typography;

const STATUS_COLOR: Record<OrderServiceStatus, string> = {
  PENDING: 'gold',
  IN_PROGRESS: 'blue',
  COMPLETED: 'green',
  CANCELLED: 'default',
};

interface OrdersSummaryCardProps {
  visitId: string;
}

// Canvas-mode fast path, same pattern as DiagnosisSummaryCard: search and
// add inline, no modal detour (user feedback: "save time, less click").
export function OrdersSummaryCard({ visitId }: OrdersSummaryCardProps) {
  const { data: services } = useServices();
  const { data: orders } = useOrderServices(visitId);
  const createOrder = useCreateOrderService(visitId);
  const cancelOrder = useCancelOrderService(visitId);

  return (
    <Card
      size="small"
      title="Orders & Services"
      extra={
        <Select
          showSearch
          size="small"
          style={{ width: 140 }}
          placeholder="Search & add..."
          value={null}
          onChange={(serviceCatalogId: string) => createOrder.mutate({ visitId, serviceCatalogId })}
          filterOption={(input, option) => (option?.label as string).toLowerCase().includes(input.toLowerCase())}
          options={services?.map((service) => ({ value: service.id, label: service.name }))}
        />
      }
      style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
      styles={{
        header: { padding: '4px 12px', minHeight: 32 },
        body: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: 8 },
      }}
    >
      {!orders || orders.length === 0 ? (
        <Empty
          image={<SafetyCertificateOutlined style={{ fontSize: 24, opacity: 0.3 }} />}
          description="No orders/services"
        />
      ) : (
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          {orders.map((order) => (
            <div key={order.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: 12 }}>
                {order.procedureName}
                <Tag color={STATUS_COLOR[order.status]} style={{ marginLeft: 6 }}>
                  {order.status}
                </Tag>
              </Text>
              {order.status === 'PENDING' && (
                <Popconfirm title="Cancel this order?" onConfirm={() => cancelOrder.mutate({ id: order.id })}>
                  <CloseOutlined style={{ fontSize: 11, cursor: 'pointer', opacity: 0.5, padding: 4 }} />
                </Popconfirm>
              )}
            </div>
          ))}
        </Space>
      )}
    </Card>
  );
}
