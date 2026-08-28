import { useState } from 'react';
import { DatePicker, Tag } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection, AdminShell } from '../components/AdminShell';
import { StatStrip } from '../components/StatStrip';
import { DataTable, money } from '../components/DataTable';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { usePaymentReport } from '../hooks/useAdmin';

/**
 * THE PAYMENT REPORT — money movements, by the date the money MOVED.
 *
 * Distinct from the sales report on purpose, and the two dates sit side by side
 * in the table so the difference is visible rather than asserted: a clinic where
 * "payment date" and "invoice date" are the same number every month is a clinic
 * where nobody has ever paid late.
 */
export function PaymentsPage() {
  const { clinicId } = useClinicFilter();
  const [range, setRange] = useState<[string, string]>([
    dayjs().startOf('month').format('YYYY-MM-DD'),
    dayjs().format('YYYY-MM-DD'),
  ]);
  const { data, isLoading } = usePaymentReport({ from: range[0], to: range[1], clinicId });

  return (
    <AdminShell
      title="Payments"
      subtitle="Every movement of money, bucketed by the day it moved — not by the day the bill was raised."
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
      <StatStrip
        stats={[
          { label: 'Received', value: money(data?.grossReceived ?? 0), tone: 'good' },
          { label: 'Refunded', value: money(data?.refunded ?? 0), tone: (data?.refunded ?? 0) > 0 ? 'warn' : 'neutral' },
          { label: 'Net', value: money(data?.netReceived ?? 0) },
          { label: 'Movements', value: data?.count ?? 0 },
        ]}
      />

      <AdminNotice>
        A REVERSAL is not a refund. A refund is money genuinely handed back and it counts; a reversal says the record was
        wrong, and both rows stay on the ledger with neither counting toward the net.
      </AdminNotice>

      <div className="kw-adminGrid kw-adminGrid--sidebar">
        <AdminSection title="Every movement" padded={false}>
          <DataTable
            rows={data?.rows}
            loading={isLoading}
            rowKey="id"
            exportName="payments"
            searchFields={['patientName' as never, 'invoiceNumber' as never, 'referenceNo' as never, 'receivedBy' as never]}
            searchPlaceholder="Search patient, invoice, reference or staff…"
            emptyText="No money moved in this period"
            scrollY={560}
            columns={[
              {
                title: 'Received',
                dataIndex: 'receivedAt',
                key: 'receivedAt',
                sorter: (a, b) => a.receivedAt.localeCompare(b.receivedAt),
                defaultSortOrder: 'descend',
                render: (value: string) => dayjs(value).format('D MMM, HH:mm'),
              },
              {
                title: 'Invoice date',
                dataIndex: 'invoiceDate',
                key: 'invoiceDate',
                render: (value: string | null) =>
                  value ? <span className="kw-muted">{dayjs(value).format('D MMM YY')}</span> : '—',
              },
              { title: 'Invoice', dataIndex: 'invoiceNumber', key: 'invoiceNumber' },
              { title: 'Patient', dataIndex: 'patientName', key: 'patientName' },
              {
                title: 'Kind',
                dataIndex: 'kind',
                key: 'kind',
                filters: [
                  { text: 'Payment', value: 'PAYMENT' },
                  { text: 'Refund', value: 'REFUND' },
                ],
                onFilter: (value, row) => row.kind === value,
                render: (kind: string, row) =>
                  row.reversed ? <Tag>Reversed</Tag> : kind === 'REFUND' ? <Tag color="red">Refund</Tag> : <Tag color="green">Payment</Tag>,
              },
              { title: 'Tender', dataIndex: 'tender', key: 'tender' },
              { title: 'Method', dataIndex: 'methodLabel', key: 'methodLabel', optional: true },
              {
                title: 'Amount',
                dataIndex: 'amount',
                key: 'amount',
                className: 'kw-num',
                sorter: (a, b) => a.amount - b.amount,
                render: (value: number, row) => (
                  <span className={row.reversed ? 'kw-muted' : row.kind === 'REFUND' ? 'kw-bad' : undefined}>
                    {money(value)}
                  </span>
                ),
              },
              { title: 'Reference', dataIndex: 'referenceNo', key: 'referenceNo', optional: true },
              { title: 'Branch', dataIndex: 'clinicName', key: 'clinicName', optional: true },
              { title: 'Taken by', dataIndex: 'receivedBy', key: 'receivedBy' },
              { title: 'Reversal reason', dataIndex: 'reversalReason', key: 'reversalReason', optional: true },
            ]}
          />
        </AdminSection>

        <AdminSection title="By tender">
          <DataTable
            rows={data?.byTender}
            rowKey="tender"
            emptyText="Nothing yet"
            columns={[
              { title: 'Tender', dataIndex: 'tender', key: 'tender' },
              { title: 'Count', dataIndex: 'count', key: 'count', className: 'kw-num' },
              { title: 'Net', dataIndex: 'amount', key: 'amount', className: 'kw-num', render: (v: number) => money(v) },
            ]}
          />
        </AdminSection>
      </div>
    </AdminShell>
  );
}
