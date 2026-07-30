import { useState } from 'react';
import { Select, Space, Table, Typography } from 'antd';
import { useClinics } from '../core/hooks/useClinics';
import { useLowStock } from './hooks/useStock';

const { Title } = Typography;

export function LowStockPage() {
  const [clinicId, setClinicId] = useState<string>();
  const { data: clinics } = useClinics();
  const { data: lowStock, isLoading } = useLowStock(clinicId);

  const clinicName = (id: string) => clinics?.find((clinic) => clinic.id === id)?.name ?? id;

  return (
    <>
      <Title level={4} style={{ marginBottom: 16 }}>
        Low Stock
      </Title>
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
        ]}
      />
    </>
  );
}
