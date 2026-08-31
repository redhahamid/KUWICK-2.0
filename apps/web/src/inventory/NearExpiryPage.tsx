import { useState } from 'react';
import { Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { useClinicFilter } from '../core/hooks/useClinicFilter';
import { useNearExpiry } from './hooks/useStock';
import { NearExpiryBatch } from './types';

const { Title, Text } = Typography;

const WINDOW_OPTIONS = [
  { value: 30, label: 'Within 30 days' },
  { value: 60, label: 'Within 60 days' },
  { value: 90, label: 'Within 90 days' },
  { value: 180, label: 'Within 180 days' },
];

function expiryTag(daysToExpiry: number) {
  if (daysToExpiry < 0) return <Tag color="red">Expired</Tag>;
  if (daysToExpiry <= 30) return <Tag color="volcano">{daysToExpiry} days left</Tag>;
  if (daysToExpiry <= 60) return <Tag color="orange">{daysToExpiry} days left</Tag>;
  return <Tag color="gold">{daysToExpiry} days left</Tag>;
}

// D-043 — surfaces StockBatch.expiryDate, captured since the Task #62
// quick-add/GRN flows but never reported on until now.
export function NearExpiryPage() {
  const { clinicId, setClinicId, clinics, showSelector } = useClinicFilter();
  const [withinDays, setWithinDays] = useState(90);
  const { data: batches, isLoading } = useNearExpiry(clinicId, withinDays);

  return (
    <>
      <Title level={4} style={{ margin: 0 }}>
        Near-Expiry Stock
      </Title>
      <Text type="secondary">Batches with stock still on hand, ordered by soonest expiry first.</Text>
      <Space style={{ margin: '16px 0' }} wrap>
        {showSelector && (
          <Select
            allowClear
            placeholder="Filter by clinic"
            style={{ width: 220 }}
            value={clinicId}
            onChange={setClinicId}
            options={clinics?.map((clinic) => ({ value: clinic.id, label: clinic.name }))}
          />
        )}
        <Select style={{ width: 180 }} value={withinDays} onChange={setWithinDays} options={WINDOW_OPTIONS} />
      </Space>
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={batches}
        columns={[
          { title: 'Item', render: (_: unknown, record: NearExpiryBatch) => record.item.name },
          { title: 'Batch No.', dataIndex: 'batchNumber', render: (value: string | null) => value ?? '—' },
          { title: 'Clinic', render: (_: unknown, record: NearExpiryBatch) => record.clinic.name },
          {
            title: 'Received',
            dataIndex: 'receivedQuantity',
            render: (value: number) => value ?? '—',
          },
          {
            // Kuwick does not attribute a dispense to a batch, so what is LEFT
            // of one is not a number that exists. What is certain is that no
            // batch can hold more than the clinic holds of the item, and this
            // column says so rather than passing the received quantity off as
            // the remainder.
            title: 'At risk (at most)',
            dataIndex: 'atRiskQuantity',
            render: (value: number, record: NearExpiryBatch) =>
              value < record.receivedQuantity ? (
                <Tooltip title={`Only ${record.itemOnHand} of this item are on hand across all batches, so no more than that can be left of this one.`}>
                  <strong>{value}</strong>
                </Tooltip>
              ) : (
                <strong>{value}</strong>
              ),
          },
          {
            title: 'Expiry Date',
            dataIndex: 'expiryDate',
            render: (value: string | null) => (value ? new Date(value).toLocaleDateString() : '—'),
          },
          {
            title: 'Status',
            dataIndex: 'daysToExpiry',
            render: (value: number) => expiryTag(value),
          },
          {
            title: 'Supplier',
            render: (_: unknown, record: NearExpiryBatch) => record.supplier?.name ?? '—',
          },
        ]}
      />
    </>
  );
}
