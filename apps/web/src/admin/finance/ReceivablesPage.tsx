import { useState } from 'react';
import { DatePicker, Tag } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection, AdminShell } from '../components/AdminShell';
import { ExceptionTiles, StatStrip } from '../components/StatStrip';
import { DataTable, money } from '../components/DataTable';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { usePanelReconciliation, usePatientReceivables } from '../hooks/useAdmin';

/**
 * OUTSTANDING — and the three receivables the brief insists are kept apart.
 *
 * Patient, panel and corporate money is chased by different people with
 * different escalation. Adding them into one "outstanding" figure is how a
 * clinic ends up phoning a patient about money a panel owes, so the two we
 * have are shown side by side and never summed into a headline.
 */
export function ReceivablesPage() {
  const { clinicId } = useClinicFilter();
  const [asOf, setAsOf] = useState(dayjs().format('YYYY-MM-DD'));
  const patients = usePatientReceivables({ clinicId, asOf });
  const panel = usePanelReconciliation({});

  const aging = patients.data?.aging;

  return (
    <AdminShell
      title="Outstanding"
      subtitle="Patient money and panel money are chased differently, so they are never added into one figure."
      actions={
        <DatePicker
          allowClear={false}
          size="small"
          value={dayjs(asOf)}
          onChange={(value) => value && setAsOf(value.format('YYYY-MM-DD'))}
        />
      }
    >
      <StatStrip
        stats={[
          {
            label: 'Patient receivable',
            value: money(patients.data?.totalOutstanding ?? 0),
            hint: `${patients.data?.invoiceCount ?? 0} invoices`,
            tone: 'warn',
          },
          {
            label: 'Panel receivable',
            value: money(panel.data?.totals.outstanding ?? 0),
            hint: `${panel.data?.totals.claims ?? 0} claims`,
            tone: 'warn',
            explain: 'Chased through the Panel module. Once a panel has adjudicated, this is what they APPROVED, not what was claimed.',
          },
          {
            label: 'Over 90 days',
            value: money(aging?.d90_plus ?? 0),
            tone: (aging?.d90_plus ?? 0) > 0 ? 'bad' : 'good',
          },
          {
            label: 'Unresolved split',
            value: patients.data?.unresolvedCount ?? 0,
            tone: (patients.data?.unresolvedCount ?? 0) > 0 ? 'bad' : 'good',
            hint: 'Cannot be aged',
          },
        ]}
      />

      <AdminSection title="Patient receivables by age" description="Aged from the invoice date, as at the selected day.">
        <ExceptionTiles
          tiles={[
            { key: 'c', label: `0–30 days · ${money(aging?.current ?? 0)}`, count: 0, tone: 'info' },
            { key: 'a', label: `31–60 days · ${money(aging?.d31_60 ?? 0)}`, count: 0, tone: 'warn' },
            { key: 'b', label: `61–90 days · ${money(aging?.d61_90 ?? 0)}`, count: 0, tone: 'warn' },
            { key: 'd', label: `Over 90 · ${money(aging?.d90_plus ?? 0)}`, count: 0, tone: 'bad' },
          ]}
        />
      </AdminSection>

      {(patients.data?.unresolvedCount ?? 0) > 0 ? (
        <AdminNotice tone="warn">
          {patients.data?.unresolvedCount} invoice(s) have no confirmed patient/panel split. They are excluded from every
          figure on this page rather than counted at either extreme — confirm the split on the visit to resolve them.
        </AdminNotice>
      ) : null}

      <AdminSection title="Who owes what" padded={false}>
        <DataTable
          rows={patients.data?.rows}
          loading={patients.isLoading}
          rowKey="invoiceId"
          exportName="patient-receivables"
          searchFields={['patientName' as never, 'invoiceNumber' as never, 'panelName' as never]}
          searchPlaceholder="Search patient or invoice…"
          emptyText="No patient owes the clinic anything"
          scrollY={520}
          columns={[
            { title: 'Invoice', dataIndex: 'invoiceNumber', key: 'invoiceNumber', sorter: (a, b) => a.invoiceNumber.localeCompare(b.invoiceNumber) },
            {
              title: 'Date',
              dataIndex: 'invoiceDate',
              key: 'invoiceDate',
              render: (value: string) => dayjs(value).format('D MMM YY'),
              sorter: (a, b) => a.invoiceDate.localeCompare(b.invoiceDate),
            },
            {
              title: 'Age',
              dataIndex: 'ageDays',
              key: 'ageDays',
              className: 'kw-num',
              defaultSortOrder: 'descend',
              sorter: (a, b) => a.ageDays - b.ageDays,
              render: (days: number) => (
                <span className={days > 90 ? 'kw-bad' : days > 30 ? 'kw-warn' : undefined}>{days}d</span>
              ),
            },
            { title: 'Patient', dataIndex: 'patientName', key: 'patientName' },
            { title: 'Phone', dataIndex: 'patientPhone', key: 'patientPhone', optional: true },
            { title: 'Branch', dataIndex: 'clinicName', key: 'clinicName', optional: true },
            {
              title: 'Panel',
              dataIndex: 'panelName',
              key: 'panelName',
              render: (name: string | null) => (name ? <Tag>{name}</Tag> : <span className="kw-muted">Self-pay</span>),
            },
            {
              title: 'Invoice total',
              dataIndex: 'invoiceTotal',
              key: 'invoiceTotal',
              className: 'kw-num',
              optional: true,
              render: (value: number) => money(value),
            },
            {
              title: 'Patient owes',
              dataIndex: 'patientResponsibility',
              key: 'patientResponsibility',
              className: 'kw-num',
              render: (value: number) => money(value),
            },
            { title: 'Received', dataIndex: 'received', key: 'received', className: 'kw-num', render: (v: number) => money(v) },
            { title: 'Credited', dataIndex: 'credited', key: 'credited', className: 'kw-num', optional: true, render: (v: number) => money(v) },
            {
              title: 'Balance',
              dataIndex: 'balance',
              key: 'balance',
              className: 'kw-num',
              sorter: (a, b) => a.balance - b.balance,
              render: (value: number) => <strong>{money(value)}</strong>,
            },
          ]}
          summary={(rows) => (
            <DataTableTotals
              count={rows.length}
              total={rows.reduce((sum, row) => sum + (row as { balance: number }).balance, 0)}
            />
          )}
        />
      </AdminSection>

      <AdminSection
        title="Panel receivables by company"
        description="What each panel still owes, and how quickly they have historically paid."
        padded={false}
      >
        <DataTable
          rows={panel.data?.byPanel}
          loading={panel.isLoading}
          rowKey="panelClinicId"
          exportName="panel-receivables"
          emptyText="No panel owes the clinic anything"
          columns={[
            { title: 'Panel', dataIndex: 'panelName', key: 'panelName' },
            { title: 'Claims', dataIndex: 'claims', key: 'claims', className: 'kw-num' },
            {
              title: 'Expected',
              dataIndex: 'expectedReceivable',
              key: 'expectedReceivable',
              className: 'kw-num',
              render: (v: number) => money(v),
            },
            { title: 'Received', dataIndex: 'received', key: 'received', className: 'kw-num', render: (v: number) => money(v) },
            {
              title: 'Outstanding',
              dataIndex: 'outstanding',
              key: 'outstanding',
              className: 'kw-num',
              sorter: (a, b) => a.outstanding - b.outstanding,
              defaultSortOrder: 'descend',
              render: (v: number) => <strong>{money(v)}</strong>,
            },
            {
              title: 'Collected',
              dataIndex: 'collectionRate',
              key: 'collectionRate',
              className: 'kw-num',
              render: (rate: number | null) => (rate === null ? '—' : `${rate}%`),
            },
            {
              title: 'Overdue',
              dataIndex: 'overdueClaims',
              key: 'overdueClaims',
              className: 'kw-num',
              render: (count: number) => (count > 0 ? <span className="kw-bad">{count}</span> : '0'),
            },
            {
              title: 'Turnaround',
              dataIndex: 'averageTurnaroundDays',
              key: 'averageTurnaroundDays',
              className: 'kw-num',
              optional: true,
              render: (days: number | null) => (days === null ? '—' : `${days}d`),
            },
          ]}
        />
      </AdminSection>
    </AdminShell>
  );
}

function DataTableTotals({ count, total }: { count: number; total: number }) {
  return (
    <tr className="kw-tableTotals">
      <td colSpan={99}>
        <span>{count} invoice(s)</span>
        <strong>{money(total)} outstanding</strong>
      </td>
    </tr>
  );
}
