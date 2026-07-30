import { useState } from 'react';
import { Button, Select, Space, Table, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { PurchaseOrderStatus, PURCHASE_ORDER_STATUS_TONE } from '@kuwick/shared';
import { StatusBadge } from '../design-system/components/StatusBadge';
import { useClinics } from '../core/hooks/useClinics';
import { usePurchaseOrders } from './hooks/usePurchaseOrders';
import { CreatePurchaseOrderDrawer } from './CreatePurchaseOrderDrawer';
import { ReceivePurchaseOrderDrawer } from './ReceivePurchaseOrderDrawer';
import { PurchaseOrder } from './types';

const { Title } = Typography;

const RECEIVABLE_STATUSES: PurchaseOrderStatus[] = [
  PurchaseOrderStatus.ORDERED,
  PurchaseOrderStatus.PARTIALLY_RECEIVED,
];

export function PurchaseOrdersPage() {
  const [clinicId, setClinicId] = useState<string>();
  const [status, setStatus] = useState<PurchaseOrderStatus>();
  const [createOpen, setCreateOpen] = useState(false);
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null);

  const { data: clinics } = useClinics();
  const { data: purchaseOrders, isLoading } = usePurchaseOrders({ clinicId, status });

  const clinicName = (id: string) => clinics?.find((clinic) => clinic.id === id)?.name ?? id;

  return (
    <>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Title level={4} style={{ margin: 0 }}>
          Purchase Orders
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          New Purchase Order
        </Button>
      </Space>
      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          allowClear
          placeholder="Filter by clinic"
          style={{ width: 200 }}
          value={clinicId}
          onChange={setClinicId}
          options={clinics?.map((clinic) => ({ value: clinic.id, label: clinic.name }))}
        />
        <Select
          allowClear
          placeholder="Filter by status"
          style={{ width: 200 }}
          value={status}
          onChange={setStatus}
          options={Object.values(PurchaseOrderStatus).map((value) => ({ value, label: value }))}
        />
      </Space>
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={purchaseOrders}
        expandable={{
          expandedRowRender: (record: PurchaseOrder) => (
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={record.lines}
              columns={[
                { title: 'Item', render: (_, line) => line.item.name },
                { title: 'Ordered Qty', dataIndex: 'orderedQuantity' },
                { title: 'Received Qty', dataIndex: 'receivedQuantity' },
                { title: 'Unit Cost (RM)', dataIndex: 'unitCost' },
              ]}
            />
          ),
        }}
        columns={[
          { title: 'Supplier', render: (_, record: PurchaseOrder) => record.supplier.name },
          { title: 'Clinic', render: (_, record: PurchaseOrder) => clinicName(record.clinicId) },
          {
            title: 'Ordered At',
            render: (_, record: PurchaseOrder) => dayjs(record.orderedAt).format('YYYY-MM-DD HH:mm'),
          },
          {
            title: 'Status',
            dataIndex: 'status',
            render: (value: PurchaseOrderStatus) => (
              <StatusBadge label={value} tone={PURCHASE_ORDER_STATUS_TONE[value]} />
            ),
          },
          {
            title: 'Actions',
            render: (_, record: PurchaseOrder) =>
              RECEIVABLE_STATUSES.includes(record.status) && (
                <Button size="small" onClick={() => setReceiving(record)}>
                  Receive
                </Button>
              ),
          },
        ]}
      />
      <CreatePurchaseOrderDrawer open={createOpen} onClose={() => setCreateOpen(false)} />
      <ReceivePurchaseOrderDrawer purchaseOrder={receiving} onClose={() => setReceiving(null)} />
    </>
  );
}
