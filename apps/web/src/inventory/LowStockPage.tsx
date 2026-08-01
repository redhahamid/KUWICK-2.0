import { useState } from 'react';
import { Button, message, Select, Space, Table, Tag, Typography } from 'antd';
import { ShoppingCartOutlined } from '@ant-design/icons';
import { ProcurementRequestStatus } from '@kuwick/shared';
import { useClinicFilter } from '../core/hooks/useClinicFilter';
import { useLowStock } from './hooks/useStock';
import { useCreateProcurementRequest, useProcurementRequests } from './hooks/useProcurementRequests';
import { ApiError } from '../core/api-client';
import { StockLevel } from './types';

const { Title } = Typography;

export function LowStockPage() {
  const { clinicId, setClinicId, clinics, showSelector } = useClinicFilter();
  const { data: lowStock, isLoading } = useLowStock(clinicId);
  const { data: openRequests } = useProcurementRequests({ status: ProcurementRequestStatus.PENDING });
  const createProcurementRequest = useCreateProcurementRequest();
  const [reorderingId, setReorderingId] = useState<string>();

  const clinicName = (id: string) => clinics?.find((clinic) => clinic.id === id)?.name ?? id;

  const alreadyRequested = (record: StockLevel) =>
    openRequests?.some((req) => req.clinicId === record.clinicId && req.itemId === record.itemId) ?? false;

  const handleReorder = async (record: StockLevel) => {
    const shortBy = record.minThreshold - record.quantityOnHand;
    setReorderingId(record.id);
    try {
      await createProcurementRequest.mutateAsync({
        clinicId: record.clinicId,
        itemId: record.itemId,
        requestedQuantity: Math.max(shortBy, 1),
      });
      message.success(`Procurement request raised for ${record.item.name}`);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to raise procurement request');
    } finally {
      setReorderingId(undefined);
    }
  };

  return (
    <>
      <Title level={4} style={{ marginBottom: 16 }}>
        Low Stock
      </Title>
      {showSelector && (
        <Space style={{ marginBottom: 16 }} wrap>
          <Select
            allowClear
            placeholder="Filter by clinic"
            style={{ width: 220 }}
            value={clinicId}
            onChange={setClinicId}
            options={clinics?.map((clinic) => ({ value: clinic.id, label: clinic.name }))}
          />
        </Space>
      )}
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={lowStock}
        columns={[
          { title: 'Item', render: (_, record) => record.item.name },
          { title: 'Clinic', render: (_, record) => clinicName(record.clinicId) },
          { title: 'Quantity On Hand', dataIndex: 'quantityOnHand' },
          { title: 'Min Threshold', dataIndex: 'minThreshold' },
          { title: 'Short By', render: (_, record) => record.minThreshold - record.quantityOnHand },
          {
            title: 'Reorder',
            render: (_, record) =>
              alreadyRequested(record) ? (
                <Tag color="processing">Request pending</Tag>
              ) : (
                <Button
                  size="small"
                  icon={<ShoppingCartOutlined />}
                  loading={reorderingId === record.id}
                  onClick={() => handleReorder(record)}
                >
                  Reorder
                </Button>
              ),
          },
        ]}
      />
    </>
  );
}
