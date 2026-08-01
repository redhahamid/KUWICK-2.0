import { useMemo, useState } from 'react';
import { Alert, Button, InputNumber, message, Select, Space, Table, Tag, Typography } from 'antd';
import { useClinicFilter } from '../core/hooks/useClinicFilter';
import { useStaff } from '../hr/hooks/useStaff';
import { usePerformStockTake } from './hooks/useStock';
import { useStockLevels } from './hooks/useStock';
import { ApiError } from '../core/api-client';
import { StockTakeResult } from './types';

const { Title, Text } = Typography;

function varianceTag(variance: number) {
  if (variance === 0) return <Tag color="success">Matched</Tag>;
  if (variance > 0) return <Tag color="blue">+{variance} over</Tag>;
  return <Tag color="error">{variance} short</Tag>;
}

// D-043 — physical count vs system. Only items with a counted quantity
// entered are submitted; every variance writes an ADJUSTMENT stock
// movement (apps/api/src/inventory/stock.service.ts performStockTake),
// same ledger every other stock change goes through.
export function StockTakePage() {
  const { clinicId, setClinicId, clinics, showSelector } = useClinicFilter();
  const [countedByStaffId, setCountedByStaffId] = useState<string>();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [result, setResult] = useState<StockTakeResult | null>(null);
  const { data: staff } = useStaff();
  const { data: levels, isLoading } = useStockLevels(clinicId);
  const performStockTake = usePerformStockTake();

  const countedRows = useMemo(() => Object.keys(counts).length, [counts]);

  const handleClinicChange = (value: string) => {
    setClinicId(value);
    setCounts({});
    setResult(null);
  };

  const handleSubmit = async () => {
    if (!clinicId) return;
    const entries = Object.entries(counts).filter(([, value]) => value !== undefined && value !== null);
    if (entries.length === 0) {
      message.warning('Enter at least one counted quantity');
      return;
    }
    try {
      const response = await performStockTake.mutateAsync({
        clinicId,
        countedByStaffId,
        counts: entries.map(([itemId, countedQuantity]) => ({ itemId, countedQuantity })),
      });
      setResult(response);
      setCounts({});
      message.success(`Stock take saved — ${response.adjustedItems} item(s) adjusted`);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to save stock take');
    }
  };

  return (
    <>
      <Title level={4} style={{ margin: 0 }}>
        Stock Take
      </Title>
      <Text type="secondary">
        Enter the physical count for items that differ from system quantity — matching items need no entry.
      </Text>
      <Space style={{ margin: '16px 0' }} wrap>
        {showSelector && (
          <Select
            placeholder="Select clinic"
            style={{ width: 220 }}
            value={clinicId}
            onChange={handleClinicChange}
            options={clinics?.map((clinic) => ({ value: clinic.id, label: clinic.name }))}
          />
        )}
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="Counted by"
          style={{ width: 200 }}
          value={countedByStaffId}
          onChange={setCountedByStaffId}
          options={staff?.map((s) => ({ value: s.id, label: s.fullName }))}
        />
        <Button type="primary" disabled={!clinicId} loading={performStockTake.isPending} onClick={handleSubmit}>
          Submit Stock Take ({countedRows})
        </Button>
      </Space>

      {result && (
        <Alert
          style={{ marginBottom: 16 }}
          type="success"
          showIcon
          closable
          onClose={() => setResult(null)}
          message={`Last stock take: ${result.countedItems} counted, ${result.adjustedItems} adjusted`}
          description={
            <Table
              size="small"
              rowKey="itemId"
              pagination={false}
              dataSource={result.results.filter((row) => row.variance !== 0)}
              columns={[
                { title: 'Item', dataIndex: 'itemName' },
                { title: 'System', dataIndex: 'systemQuantity' },
                { title: 'Counted', dataIndex: 'countedQuantity' },
                { title: 'Variance', dataIndex: 'variance', render: (value: number) => varianceTag(value) },
              ]}
            />
          }
        />
      )}

      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={clinicId ? levels : []}
        locale={{ emptyText: clinicId ? 'No stock levels for this clinic' : 'Select a clinic to begin' }}
        columns={[
          { title: 'Item', render: (_, record) => record.item.name },
          { title: 'System Quantity', dataIndex: 'quantityOnHand' },
          {
            title: 'Counted Quantity',
            render: (_, record) => (
              <InputNumber
                min={0}
                placeholder="—"
                value={counts[record.itemId]}
                onChange={(value) =>
                  setCounts((prev) => {
                    const next = { ...prev };
                    if (value === null || value === undefined) {
                      delete next[record.itemId];
                    } else {
                      next[record.itemId] = value;
                    }
                    return next;
                  })
                }
              />
            ),
          },
          {
            title: 'Variance',
            render: (_, record) => {
              const counted = counts[record.itemId];
              if (counted === undefined) return '—';
              return varianceTag(counted - record.quantityOnHand);
            },
          },
        ]}
      />
    </>
  );
}
