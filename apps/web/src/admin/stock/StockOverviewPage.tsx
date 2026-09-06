import { useMemo, useState } from 'react';
import { Tag, Tooltip } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { ExceptionTiles, StatStrip } from '../components/StatStrip';
import { DataTable, money } from '../components/DataTable';
import type { DataTableColumn } from '../components/DataTable';
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

/**
 * The attention board, and the valuation that sits under it.
 *
 * The Admin rail names three doors into this one page — what needs attention,
 * slow moving, and stock value — because those are three questions an owner
 * asks separately. They are props, not three copies of the screen: a
 * duplicated board is a board that drifts from the ledger it reads.
 */
/**
 * THE COLUMNS the exception views share. Defined once — see
 * `ExceptionRowsTable` for what happened when they were not.
 */
const EXCEPTION_COLUMNS: DataTableColumn<Record<string, unknown>>[] = [
  { title: 'Item', dataIndex: 'itemName', key: 'itemName' },
  { title: 'Code', dataIndex: 'itemCode', key: 'itemCode', optional: true },
  { title: 'Branch', dataIndex: 'clinicName', key: 'clinicName' },
  { title: 'Category', dataIndex: 'category', key: 'category', optional: true },
  {
    title: 'Batch',
    dataIndex: 'batchNumber',
    key: 'batchNumber',
    render: (value) => (value as string | null) ?? '—',
  },
  {
    title: 'On hand',
    dataIndex: 'quantityOnHand',
    key: 'quantityOnHand',
    className: 'kw-num',
    // NO FALLBACK to a batch's `quantity`. That column is what was RECEIVED in
    // the batch and never decrements — Kuwick does not attribute a dispense to
    // a batch — so showing it under "on hand" reported a fully-dispensed batch
    // at its full size. Batch rows carry their own honest columns below.
    render: (value) => {
      const quantity = value as number | undefined;
      if (quantity === undefined) return '—';
      return <span className={quantity < 0 ? 'kw-bad' : undefined}>{quantity}</span>;
    },
  },
  {
    title: 'Received',
    dataIndex: 'quantity',
    key: 'quantity',
    className: 'kw-num',
    render: (value) => ((value as number | undefined) === undefined ? '—' : (value as number)),
  },
  {
    title: 'At risk (at most)',
    dataIndex: 'atRiskQuantity',
    key: 'atRiskQuantity',
    className: 'kw-num',
    render: (value, row) => {
      const atRisk = value as number | undefined;
      if (atRisk === undefined) return '—';
      const received = row.quantity as number | undefined;
      const onHand = row.itemOnHand as number | undefined;
      return atRisk < (received ?? 0) ? (
        <Tooltip
          title={`Only ${onHand} of this item are on hand across all batches, so no more than that can be left of this one. Kuwick does not attribute a dispense to a batch, so the exact remainder is not known.`}
        >
          <strong>{atRisk}</strong>
        </Tooltip>
      ) : (
        <strong>{atRisk}</strong>
      );
    },
  },
  { title: 'Minimum', dataIndex: 'minThreshold', key: 'minThreshold', className: 'kw-num', optional: true },
  {
    title: 'Shortfall',
    dataIndex: 'shortfall',
    key: 'shortfall',
    className: 'kw-num',
    render: (value) =>
      (value as number | undefined) === undefined ? '—' : <span className="kw-warn">{value as number}</span>,
  },
  {
    title: 'Expiry',
    dataIndex: 'expiryDate',
    key: 'expiryDate',
    render: (value, row) => {
      if (!value) return '—';
      const days = row.daysToExpiry as number | null;
      return (
        <span className={days !== null && days < 0 ? 'kw-bad' : days !== null && days < 30 ? 'kw-warn' : undefined}>
          {dayjs(value as string).format('D MMM YY')}
          {days !== null ? ` (${days}d)` : ''}
        </span>
      );
    },
  },
  {
    title: 'Last dispensed',
    dataIndex: 'lastDispensedAt',
    key: 'lastDispensedAt',
    render: (value, row) =>
      value ? (
        `${dayjs(value as string).format('D MMM YY')} (${row.daysSinceDispense as number}d)`
      ) : (
        <span className="kw-muted">Never</span>
      ),
  },
  {
    title: 'Value at cost',
    dataIndex: 'valueAtCost',
    key: 'valueAtCost',
    className: 'kw-num',
    render: (value) => ((value as number | undefined) === undefined ? '—' : money(value as number)),
  },
];

/**
 * THE EXCEPTION ROWS TABLE.
 *
 * ONE definition, used by both of this page's layouts. It was literally
 * duplicated — the same fifteen columns written out twice, once for each
 * `focus` branch — and when the batch-exposure columns were added (D-114) only
 * one copy got them, so the Near Expiry route kept showing the old five. That
 * is the same "one number maintained in two places" defect the whole
 * management programme is about, expressed in JSX.
 */
function ExceptionRowsTable({
  rows,
  view,
}: {
  rows: { data?: unknown[]; isLoading: boolean };
  view: string;
}) {
  // A column appears when at least one row carries the key at all. A key
  // present and NULL still shows — that is the view saying "genuinely never" —
  // and a key the view does not report simply is not a column.
  const reportedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const row of (rows.data ?? []) as Record<string, unknown>[]) {
      for (const [key, value] of Object.entries(row)) {
        if (value !== undefined) keys.add(key);
      }
    }
    return keys;
  }, [rows.data]);

  return (
    <DataTable
      rows={rows.data as never}
      loading={rows.isLoading}
      /*
       * THE KEY MUST CARRY EVERY DIMENSION THAT MAKES A ROW DISTINCT.
       *
       * It was `batchId ?? itemId`, and the slow-movers view is one row per
       * ITEM PER BRANCH: the same discontinued syrup sitting at two branches
       * produced two rows with one key, so React was free to omit one of them
       * and an entire branch's stock could disappear from the board without a
       * word. Branch and batch both belong in the identity.
       */
      rowKey={(row) => {
        const r = row as { itemId?: string; batchId?: string; clinicId?: string };
        return [r.itemId, r.clinicId, r.batchId].filter(Boolean).join(':');
      }}
      exportName={`stock-${view}`}
      searchFields={['itemName' as never, 'itemCode' as never, 'clinicName' as never]}
      searchPlaceholder="Search item or branch…"
      emptyText="Nothing needs attention here"
      scrollY={460}
      columns={EXCEPTION_COLUMNS.filter(
        (column) => reportedKeys.size === 0 || reportedKeys.has(column.dataIndex as string),
      )}
    />
  );
}

export function StockOverviewPage({
  initialView = 'below-minimum',
  focus = 'exceptions',
}: {
  initialView?: string;
  /** `value` puts the valuation first, for somebody asking what the shelves are worth. */
  focus?: 'exceptions' | 'value';
} = {}) {
  const { clinicId } = useClinicFilter();
  const [view, setView] = useState<string>(initialView);
  const exceptions = useStockExceptions(clinicId);
  const rows = useStockExceptionRows(view, clinicId);
  const valuation = useStockValuation(clinicId);

  const t = exceptions.data;

  /**
   * WHICH COLUMNS THIS VIEW ACTUALLY REPORTS.
   *
   * The seven exception views share one table, and each returns a different
   * subset of fields — below-minimum has no batch and no cost, near-expiry has
   * no shortfall. Rendering the full column set filled the gaps with em-dashes,
   * which on a stock screen reads as a fact: "value at cost —" says this item
   * has no cost on record, three lines under a panel reporting that none are
   * missing one. Worse, "Last dispensed: Never" appeared against an item that
   * had 185 strips dispensed out of it.
   *
   * So a column appears when at least one row carries the key at all. A key
   * present and NULL still shows — that is the view saying "genuinely never" —
   * and a key the view does not report simply is not a column.
   */
  const reportedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const row of rows.data ?? []) {
      for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
        if (value !== undefined) keys.add(key);
      }
    }
    return keys;
  }, [rows.data]);

  return (
    <AdminShell
      error={firstError(exceptions, rows, valuation)}
      title={focus === 'value' ? 'Stock Value' : 'Stock'}
      subtitle={
        focus === 'value'
          ? 'What the shelves are worth, and what still needs attention.'
          : 'What requires attention today, and what the shelves are worth.'
      }
    >
      {/* `focus` decides which question this page answers FIRST. Same data,
          same components, same queries — only the order changes, because
          "what needs attention" and "what is it all worth" are two different
          reasons to open the screen. */}
      {focus === 'value' ? (
        <>
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
        <ExceptionRowsTable rows={rows} view={view} />
      </AdminSection>
        </>
      ) : (
        <>
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
        <ExceptionRowsTable rows={rows} view={view} />
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
        </>
      )}
    </AdminShell>
  );
}
