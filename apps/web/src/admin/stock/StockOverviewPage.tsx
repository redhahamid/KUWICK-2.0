import { useState } from 'react';
import { Tag } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { ExceptionTiles, StatStrip } from '../components/StatStrip';
import { DataTable, money } from '../components/DataTable';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useStockExceptionRows, useStockExceptions, useStockValuation } from '../hooks/useAdmin';

/**
 * STOCK — the module's first question, in the brief's own words:
 *
 *   "What requires attention today?"
 *
 * Not "here is every field of every item". The exception tiles ARE the page,
 * and the table below is whichever one is selected. A tile reading zero stays
 * visible and goes quiet — "nothing expired" is information, and a tile that
 * disappears when clean teaches people not to look for it.
 */
const EXCEPTION_VIEWS: Record<string, { label: string; columns: string[] }> = {
  negative: { label: 'Negative stock', columns: ['item', 'clinic', 'qty', 'min'] },
  'below-minimum': { label: 'Below minimum', columns: ['item', 'clinic', 'qty', 'min', 'shortfall'] },
  expired: { label: 'Expired batches', columns: ['item', 'clinic', 'batch', 'qty', 'expiry', 'value'] },
  'near-expiry': { label: 'Near expiry', columns: ['item', 'clinic', 'batch', 'qty', 'expiry', 'value'] },
  'slow-moving': { label: 'Slow movers', columns: ['item', 'qty', 'lastDispensed', 'value'] },
};

export function StockOverviewPage() {
  const { clinicId } = useClinicFilter();
  const [view, setView] = useState<string>('below-minimum');
  const exceptions = useStockExceptions(clinicId);
  const rows = useStockExceptionRows(view, clinicId);
  const valuation = useStockValuation(clinicId);

  const t = exceptions.data;

  return (
    <AdminShell error={firstError(exceptions, rows, valuation)} title="Stock" subtitle="What requires attention today, and what the shelves are worth.">
      <ExceptionTiles
        selected={view}
        tiles={[
          {
            key: 'negative',
            label: 'Negative stock',
            count: t?.negativeStock ?? 0,
            tone: 'bad',
            hint: 'Dispensed beyond what the system knew about. Allowed at the counter; reconciled here.',
            onSelect: () => setView('negative'),
          },
          {
            key: 'below-minimum',
            label: 'Below minimum',
            count: t?.belowMinimum ?? 0,
            tone: 'warn',
            onSelect: () => setView('below-minimum'),
          },
          {
            key: 'expired',
            label: 'Expired',
            count: t?.expired ?? 0,
            tone: 'bad',
            onSelect: () => setView('expired'),
          },
          {
            key: 'near-expiry',
            label: `Expiring in ${t?.thresholds.nearExpiryDays ?? 90}d`,
            count: t?.nearExpiry ?? 0,
            tone: 'warn',
            onSelect: () => setView('near-expiry'),
          },
          {
            key: 'slow-moving',
            label: `Not dispensed in ${t?.thresholds.slowMovingDays ?? 90}d`,
            count: t?.slowMovers ?? 0,
            tone: 'info',
            onSelect: () => setView('slow-moving'),
          },
          { key: 'transfers', label: 'Transfers in transit', count: t?.unconfirmedTransfers ?? 0, tone: 'info' },
          { key: 'discrepancy', label: 'Transfer discrepancies', count: t?.transferDiscrepancies ?? 0, tone: 'bad' },
          { key: 'takes', label: 'Stock takes open', count: t?.openStockTakes ?? 0, tone: 'info' },
        ]}
      />

      <AdminSection
        title={EXCEPTION_VIEWS[view]?.label ?? 'Exceptions'}
        description={
          view === 'slow-moving'
            ? `An item is slow-moving when it has stock on hand and has not been dispensed for ${t?.thresholds.slowMovingDays ?? 90} days. The threshold is stated rather than hidden in a query.`
            : view === 'negative'
              ? 'A negative balance is allowed at the counter so dispensing is never blocked by a system count that has not caught up. It is reconciled here, with a reason.'
              : undefined
        }
        padded={false}
      >
        <DataTable
          rows={rows.data}
          loading={rows.isLoading}
          rowKey={(row) => String((row as { itemId?: string; batchId?: string }).batchId ?? (row as { itemId?: string }).itemId)}
          exportName={`stock-${view}`}
          searchFields={['itemName' as never, 'itemCode' as never, 'clinicName' as never]}
          searchPlaceholder="Search item or branch…"
          emptyText="Nothing needs attention here"
          scrollY={460}
          columns={[
            { title: 'Item', dataIndex: 'itemName', key: 'itemName' },
            { title: 'Code', dataIndex: 'itemCode', key: 'itemCode', optional: true },
            { title: 'Branch', dataIndex: 'clinicName', key: 'clinicName' },
            { title: 'Category', dataIndex: 'category', key: 'category', optional: true },
            {
              title: 'Batch',
              dataIndex: 'batchNumber',
              key: 'batchNumber',
              render: (value: string | null) => value ?? '—',
            },
            {
              title: 'On hand',
              dataIndex: 'quantityOnHand',
              key: 'quantityOnHand',
              className: 'kw-num',
              render: (value: number | undefined, row: Record<string, unknown>) => {
                const quantity = value ?? (row.quantity as number | undefined);
                if (quantity === undefined) return '—';
                return <span className={quantity < 0 ? 'kw-bad' : undefined}>{quantity}</span>;
              },
            },
            { title: 'Minimum', dataIndex: 'minThreshold', key: 'minThreshold', className: 'kw-num', optional: true },
            {
              title: 'Shortfall',
              dataIndex: 'shortfall',
              key: 'shortfall',
              className: 'kw-num',
              render: (value: number | undefined) => (value === undefined ? '—' : <span className="kw-warn">{value}</span>),
            },
            {
              title: 'Expiry',
              dataIndex: 'expiryDate',
              key: 'expiryDate',
              render: (value: string | null, row: Record<string, unknown>) => {
                if (!value) return '—';
                const days = row.daysToExpiry as number | null;
                return (
                  <span className={days !== null && days < 0 ? 'kw-bad' : days !== null && days < 30 ? 'kw-warn' : undefined}>
                    {dayjs(value).format('D MMM YY')}
                    {days !== null ? ` (${days}d)` : ''}
                  </span>
                );
              },
            },
            {
              title: 'Last dispensed',
              dataIndex: 'lastDispensedAt',
              key: 'lastDispensedAt',
              render: (value: string | null, row: Record<string, unknown>) =>
                value ? `${dayjs(value).format('D MMM YY')} (${row.daysSinceDispense as number}d)` : <span className="kw-muted">Never</span>,
            },
            {
              title: 'Value at cost',
              dataIndex: 'valueAtCost',
              key: 'valueAtCost',
              className: 'kw-num',
              render: (value: number | undefined) => (value === undefined ? '—' : money(value)),
            },
          ]}
        />
      </AdminSection>

      <AdminSection title="What the shelves are worth" description={valuation.data?.costingNote}>
        <StatStrip
          stats={[
            { label: 'Value at cost', value: money(valuation.data?.totalCostValue ?? 0) },
            {
              label: 'Potential self-pay value',
              value: money(valuation.data?.totalPotentialSelfPayValue ?? 0),
              tone: 'neutral',
              explain: valuation.data?.potentialValueNote,
            },
            { label: 'Items valued', value: valuation.data?.itemsValued ?? 0 },
            {
              label: 'Items without a cost',
              value: valuation.data?.itemsWithoutCost ?? 0,
              tone: (valuation.data?.itemsWithoutCost ?? 0) > 0 ? 'warn' : 'good',
              hint: 'Contribute nothing to the cost figure',
            },
          ]}
        />
        <AdminNotice>{valuation.data?.potentialValueNote}</AdminNotice>
        <DataTable
          rows={valuation.data?.byCategory}
          loading={valuation.isLoading}
          rowKey="category"
          exportName="stock-value-by-category"
          emptyText="No stock on hand"
          columns={[
            { title: 'Category', dataIndex: 'category', key: 'category' },
            { title: 'Items', dataIndex: 'items', key: 'items', className: 'kw-num' },
            { title: 'Units', dataIndex: 'units', key: 'units', className: 'kw-num' },
            { title: 'At cost', dataIndex: 'costValue', key: 'costValue', className: 'kw-num', render: (v: number) => money(v) },
            {
              title: 'Potential self-pay',
              dataIndex: 'potentialSelfPayValue',
              key: 'potentialSelfPayValue',
              className: 'kw-num',
              render: (v: number) => <span className="kw-muted">{money(v)}</span>,
            },
          ]}
        />
      </AdminSection>
    </AdminShell>
  );
}
