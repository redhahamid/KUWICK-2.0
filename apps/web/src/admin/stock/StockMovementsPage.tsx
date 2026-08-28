import { useState } from 'react';
import { DatePicker, Tag } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection, AdminShell } from '../components/AdminShell';
import { DataTable } from '../components/DataTable';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useStockMovements } from '../hooks/useAdmin';

const TYPE_COLOUR: Record<string, string> = {
  GOODS_RECEIVED: 'green',
  DISPENSED: 'blue',
  TRANSFER_OUT: 'orange',
  TRANSFER_IN: 'cyan',
  STOCK_TAKE: 'purple',
  ADJUSTMENT: 'default',
  WASTAGE: 'red',
  EXPIRY: 'red',
  INTERNAL_USE: 'gold',
  RETURN_TO_SUPPLIER: 'default',
  RETURN_FROM_PATIENT: 'default',
  OPENING_BALANCE: 'default',
};

/**
 * THE MOVEMENT LEDGER — the record every stock balance is derived from.
 *
 * Append-only and enforced: a movement recorded in error is corrected with a
 * compensating movement, never by editing this row. That is why every entry
 * here can be trusted as a record of what somebody actually did.
 */
export function StockMovementsPage() {
  const { clinicId } = useClinicFilter();
  const [range, setRange] = useState<[string, string]>([
    dayjs().subtract(30, 'day').format('YYYY-MM-DD'),
    dayjs().format('YYYY-MM-DD'),
  ]);
  const { data, isLoading } = useStockMovements({ clinicId, from: range[0], to: range[1] });

  return (
    <AdminShell
      title="Movement Ledger"
      subtitle="Every change to every stock balance, with who made it and why."
      actions={
        <DatePicker.RangePicker
          allowClear={false}
          size="small"
          value={[dayjs(range[0]), dayjs(range[1])]}
          onChange={(dates) =>
            dates?.[0] && dates?.[1] && setRange([dates[0].format('YYYY-MM-DD'), dates[1].format('YYYY-MM-DD')])
          }
        />
      }
    >
      <AdminNotice>
        This ledger is append-only, enforced by the database. A movement recorded in error is corrected with a
        compensating movement rather than by editing the original — which is what makes the stock balance derived from
        it trustworthy.
      </AdminNotice>

      <AdminSection title="Movements" padded={false}>
        <DataTable
          rows={data}
          loading={isLoading}
          rowKey="id"
          exportName="stock-movements"
          searchFields={['itemName' as never, 'itemCode' as never, 'by' as never, 'notes' as never]}
          searchPlaceholder="Search item, staff or note…"
          emptyText="No movements in this period"
          scrollY={560}
          columns={[
            {
              title: 'When',
              dataIndex: 'createdAt',
              key: 'createdAt',
              defaultSortOrder: 'descend',
              sorter: (a, b) => a.createdAt.localeCompare(b.createdAt),
              render: (value: string) => dayjs(value).format('D MMM, HH:mm'),
            },
            { title: 'Branch', dataIndex: 'clinicName', key: 'clinicName' },
            { title: 'Item', dataIndex: 'itemName', key: 'itemName' },
            { title: 'Code', dataIndex: 'itemCode', key: 'itemCode', optional: true },
            {
              title: 'Type',
              dataIndex: 'movementType',
              key: 'movementType',
              filters: Object.keys(TYPE_COLOUR).map((value) => ({ text: value.replace(/_/g, ' '), value })),
              onFilter: (value, row) => row.movementType === value,
              render: (value: string) => <Tag color={TYPE_COLOUR[value]}>{value.replace(/_/g, ' ')}</Tag>,
            },
            {
              title: 'Reason',
              dataIndex: 'adjustmentReason',
              key: 'adjustmentReason',
              render: (value: string | null) => (value ? value.replace(/_/g, ' ') : <span className="kw-muted">—</span>),
            },
            {
              title: 'Change',
              dataIndex: 'quantityDelta',
              key: 'quantityDelta',
              className: 'kw-num',
              render: (value: number) => (
                <strong className={value < 0 ? 'kw-bad' : 'kw-good'}>{value > 0 ? `+${value}` : value}</strong>
              ),
            },
            {
              title: 'Dose units',
              dataIndex: 'clinicalQuantity',
              key: 'clinicalQuantity',
              className: 'kw-num',
              optional: true,
              render: (value: number | null) => value ?? '—',
            },
            { title: 'Batch', dataIndex: 'batchNumber', key: 'batchNumber', optional: true },
            { title: 'Reference', dataIndex: 'referenceType', key: 'referenceType', optional: true },
            { title: 'By', dataIndex: 'by', key: 'by' },
            { title: 'Note', dataIndex: 'notes', key: 'notes', ellipsis: true },
          ]}
        />
      </AdminSection>
    </AdminShell>
  );
}
