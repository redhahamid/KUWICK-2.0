import dayjs from 'dayjs';
import { Tag } from 'antd';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { StatStrip } from '../components/StatStrip';
import { DataTable, DataTableTotals, money } from '../components/DataTable';
import { useStockTransfers } from '../hooks/useAdmin';
import type { StockTransferRow } from '../types';

/**
 * INTER-COMPANY — the physical movement, and the invoice that is NOT it.
 *
 * When one entity's stock goes to another's shelf, two separate things have to
 * happen: goods move, and one company bills the other. They happen at
 * different times, they are approved by different people, and they can
 * legitimately disagree for a while. Kuwick tracks the FIRST — it is the same
 * append-only transfer the Stock module records, listed here because Finance
 * is who chases the second.
 *
 * The financial document itself is issued outside Kuwick. This screen says so
 * rather than implying that a reference number means an invoice exists, and it
 * shows which transfers still have no reference at all — which is the actual
 * work item on this page.
 */
export function InterCompanyPage() {
  const transfers = useStockTransfers({});
  const rows = (transfers.data ?? []).filter((row) => row.interCompany);
  const unreferenced = rows.filter((row) => !row.interCompanyReference);
  const value = rows.reduce((total, row) => total + row.value, 0);

  return (
    <AdminShell
      error={firstError(transfers)}
      title="Inter-company"
      subtitle="Stock that crossed between entities, and the billing that has to follow it."
    >
      <StatStrip
        stats={[
          { label: 'Inter-company transfers', value: String(rows.length) },
          { label: 'Value moved', value: money(value), tone: 'neutral' },
          {
            label: 'No billing reference',
            value: String(unreferenced.length),
            tone: unreferenced.length > 0 ? 'warn' : 'neutral',
            hint: 'nothing recorded to bill against',
          },
        ]}
      />

      <AdminNotice>
        Kuwick records the PHYSICAL MOVEMENT and the reference somebody put against it. It does not raise the
        inter-company invoice, and a reference here is not evidence that one exists — it is a note saying which document
        the movement belongs to. Issuing and settling that document happens in the entities’ own accounts.
      </AdminNotice>

      {unreferenced.length > 0 ? (
        <AdminNotice tone="warn">
          {unreferenced.length} inter-company transfer(s) carry no billing reference. Stock has left one entity and
          arrived at another with nothing recorded to bill against — the longer that sits, the harder it is to
          reconstruct what the movement was for.
        </AdminNotice>
      ) : null}

      <AdminSection
        title="Inter-company movements"
        description="The same transfers the Stock module records. One source, two audiences."
        padded={false}
      >
        <DataTable<StockTransferRow>
          rowKey="id"
          rows={rows}
          loading={transfers.isLoading}
          searchPlaceholder="Search transfer or reference…"
          searchFields={['transferNumber', 'interCompanyReference', 'fromClinicName', 'toClinicName']}
          exportName="inter-company-transfers"
          emptyText="No inter-company transfers recorded"
          columns={[
            { title: 'Transfer', dataIndex: 'transferNumber', key: 'transferNumber' },
            {
              title: 'Status',
              dataIndex: 'status',
              key: 'status',
              render: (value: string) => <Tag>{value.replace(/_/g, ' ')}</Tag>,
            },
            { title: 'From', dataIndex: 'fromClinicName', key: 'fromClinicName' },
            { title: 'To', dataIndex: 'toClinicName', key: 'toClinicName' },
            { title: 'Lines', dataIndex: 'lineCount', key: 'lineCount', className: 'kw-num', optional: true },
            {
              title: 'Value',
              dataIndex: 'value',
              key: 'value',
              className: 'kw-num',
              render: (value: number) => money(value),
            },
            {
              title: 'Billing reference',
              dataIndex: 'interCompanyReference',
              key: 'interCompanyReference',
              render: (value: string | null) =>
                value ? value : <span className="kw-warn">Not recorded</span>,
            },
            {
              title: 'Sent on',
              dataIndex: 'sentAt',
              key: 'sentAt',
              render: (value: string | null) => (value ? dayjs(value).format('D MMM YY') : '—'),
            },
          ]}
          summary={(shown) => (
            <DataTableTotals
              countLabel="transfer(s)"
              label="moved between entities"
              count={shown.length}
              total={shown.reduce((sum, row) => sum + (row as StockTransferRow).value, 0)}
            />
          )}
        />
      </AdminSection>
    </AdminShell>
  );
}
