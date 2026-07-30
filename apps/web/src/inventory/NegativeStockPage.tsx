import { useState } from 'react';
import { Select, Space, Table, Typography } from 'antd';
import { useClinics } from '../core/hooks/useClinics';
import { useNegativeStock } from './hooks/useStock';

const { Title, Text } = Typography;

// Negative stock is allowed, not blocked (docs/DECISIONS.md D-020) — this
// is the reconciliation report admin uses to find and fix it: front-line
// staff dispense/invoice immediately even when system stock hasn't caught
// up with physically-received goods.
export function NegativeStockPage() {
  const [clinicId, setClinicId] = useState<string>();
  const { data: clinics } = useClinics();
  const { data: negativeStock, isLoading } = useNegativeStock(clinicId);

  const clinicName = (id: string) => clinics?.find((clinic) => clinic.id === id)?.name ?? id;

  return (
    <>
      <Title level={4} style={{ margin: 0 }}>
        Negative Stock
      </Title>
      <Text type="secondary">
        Items below zero pending reconciliation — dispensing is never blocked on system stock catching up.
      </Text>
      <Space style={{ margin: '16px 0' }} wrap>
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
        dataSource={negativeStock}
        columns={[
          { title: 'Item', render: (_, record) => record.item.name },
          { title: 'Clinic', render: (_, record) => clinicName(record.clinicId) },
          {
            title: 'Quantity On Hand',
            dataIndex: 'quantityOnHand',
            render: (value: number) => <Text type="danger">{value}</Text>,
          },
          { title: 'Min Threshold', dataIndex: 'minThreshold' },
        ]}
      />
    </>
  );
}
