import { useMemo, useState } from 'react';
import { Button, DatePicker, Tag } from 'antd';
import dayjs from 'dayjs';
import { Link, useNavigate } from 'react-router-dom';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { ExceptionTiles, StatStrip } from '../components/StatStrip';
import { DataTable, money } from '../components/DataTable';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useOpenDays, usePanelReconciliation, usePatientReceivables, usePaymentReport, useTaxReport } from '../hooks/useAdmin';

/**
 * FINANCE — the module's first question, in the brief's own words:
 *
 *   "Did yesterday reconcile, what is outstanding, and are revenue/tax figures
 *    correct?"
 *
 * So the page opens with unreconciled days, then receivables split three ways,
 * then the period's money. Nothing here is a chart for its own sake.
 */
export function FinanceOverviewPage() {
  const navigate = useNavigate();
  const { clinicId } = useClinicFilter();
  const [range, setRange] = useState<[string, string]>([
    dayjs().startOf('month').format('YYYY-MM-DD'),
    dayjs().format('YYYY-MM-DD'),
  ]);

  const openDays = useOpenDays(clinicId);
  const receivables = usePatientReceivables({ clinicId });
  const payments = usePaymentReport({ from: range[0], to: range[1], clinicId });
  const tax = useTaxReport({ from: range[0], to: range[1], clinicId });
  const panel = usePanelReconciliation({});

  const unreconciled = openDays.data ?? [];
  const aging = receivables.data?.aging;

  const stats = useMemo(
    () => [
      {
        label: 'Received this period',
        value: money(payments.data?.netReceived ?? 0),
        hint: `${payments.data?.count ?? 0} movements, ${money(payments.data?.refunded ?? 0)} refunded`,
        tone: 'good' as const,
        explain: 'Money that MOVED in the period, bucketed by the date it moved — not by the date the bill was raised.',
      },
      {
        label: 'Patient receivable',
        value: money(receivables.data?.totalOutstanding ?? 0),
        hint: `${receivables.data?.invoiceCount ?? 0} invoices`,
        tone: (receivables.data?.totalOutstanding ?? 0) > 0 ? ('warn' as const) : ('neutral' as const),
        explain: 'What patients still owe. Panel money is chased through the claim and is counted separately.',
      },
      {
        label: 'Panel receivable',
        value: money(panel.data?.totals.outstanding ?? 0),
        hint: `${panel.data?.totals.claims ?? 0} claims`,
        tone: (panel.data?.totals.outstanding ?? 0) > 0 ? ('warn' as const) : ('neutral' as const),
        explain: 'Chased through the Panel module, never by phoning the patient.',
      },
      {
        label: 'Service tax',
        value: money(tax.data?.summary.tax ?? 0),
        hint: `on ${money(tax.data?.summary.taxable ?? 0)} taxable`,
        explain: 'Summed from what each line actually charged, never by applying today’s rate to a period total.',
      },
      {
        label: 'Unreconciled days',
        value: unreconciled.length,
        hint: unreconciled.length === 0 ? 'Every day closed' : 'Close them before month end',
        tone: unreconciled.length > 0 ? ('bad' as const) : ('good' as const),
      },
    ],
    [payments.data, receivables.data, panel.data, tax.data, unreconciled.length],
  );

  return (
    <AdminShell
      error={firstError(openDays, receivables, payments, tax, panel)}
      title="Finance"
      subtitle="Did yesterday reconcile, what is outstanding, and are the revenue and tax figures right?"
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
      <StatStrip stats={stats} />

      <AdminSection
        title="Days not yet closed"
        description="A day with money taken and no signed-off closing. This list being empty is what “yesterday reconciled” means."
        padded={false}
      >
        <DataTable
          rows={unreconciled}
          loading={openDays.isLoading}
          rowKey="businessDate"
          emptyText="Every day with takings has been closed"
          emptyHint="Nothing here is the state you want."
          columns={[
            { title: 'Business date', dataIndex: 'businessDate', key: 'businessDate' },
            {
              title: 'Status',
              dataIndex: 'status',
              key: 'status',
              render: (status: string) => (
                <Tag color={status === 'COUNTED' ? 'gold' : 'default'}>{status === 'COUNTED' ? 'Counted, not closed' : 'Not counted'}</Tag>
              ),
            },
            {
              title: 'Expected in drawer',
              dataIndex: 'expectedTotal',
              key: 'expectedTotal',
              className: 'kw-num',
              render: (value: number) => money(value),
            },
            { title: 'Movements', dataIndex: 'paymentCount', key: 'paymentCount', className: 'kw-num' },
            {
              title: '',
              key: 'action',
              noExport: true,
              render: (_: unknown, row: { businessDate: string }) => (
                <Button size="small" type="link" onClick={() => navigate(`/admin/finance/day-end?date=${row.businessDate}`)}>
                  Close this day
                </Button>
              ),
            },
          ]}
        />
      </AdminSection>

      <div className="kw-adminGrid kw-adminGrid--2">
        <AdminSection
          title="Patient receivables, aged"
          description="Aged from the invoice date. Panel and inter-company receivables are chased separately and are not in this total."
        >
          <ExceptionTiles
            tiles={[
              { key: 'current', label: '0–30 days', count: Math.round(aging?.current ?? 0), tone: 'info' },
              { key: 'd31', label: '31–60 days', count: Math.round(aging?.d31_60 ?? 0), tone: 'warn' },
              { key: 'd61', label: '61–90 days', count: Math.round(aging?.d61_90 ?? 0), tone: 'warn' },
              { key: 'd90', label: 'Over 90 days', count: Math.round(aging?.d90_plus ?? 0), tone: 'bad' },
            ]}
          />
          {(receivables.data?.unresolvedCount ?? 0) > 0 ? (
            <AdminNotice tone="warn">
              {receivables.data?.unresolvedCount} invoice(s) have no confirmed patient/panel split and cannot be aged.
              They are excluded from the total above rather than guessed at.
            </AdminNotice>
          ) : null}
          <p className="kw-adminSection__desc" style={{ marginTop: 12 }}>
            <Link to="/admin/finance/receivables">Open the receivables work queue →</Link>
          </p>
        </AdminSection>

        <AdminSection title="How money arrived" description="By tender, over the selected period.">
          <DataTable
            rows={payments.data?.byTender}
            loading={payments.isLoading}
            rowKey="tender"
            emptyText="No money moved in this period"
            columns={[
              { title: 'Tender', dataIndex: 'tender', key: 'tender' },
              { title: 'Movements', dataIndex: 'count', key: 'count', className: 'kw-num' },
              {
                title: 'Net',
                dataIndex: 'amount',
                key: 'amount',
                className: 'kw-num',
                render: (value: number) => money(value),
              },
            ]}
          />
        </AdminSection>
      </div>

      <AdminSection
        title="Service tax"
        description="Summed from the tax each line actually charged, at the rate in force on its own invoice date."
      >
        {tax.data && tax.data.summary.notClassified > 0 ? (
          <AdminNotice tone="warn">
            {money(tax.data.summary.notClassified)} of revenue carries no tax classification. It is reported here as
            “not classified” rather than assumed exempt — map the items to a tax code to resolve it.
          </AdminNotice>
        ) : null}
        <DataTable
          rows={tax.data?.byCode}
          loading={tax.isLoading}
          rowKey="code"
          exportName="tax-by-code"
          emptyText="No taxable activity in this period"
          emptyHint="A clinic that is not tax-registered will always see this."
          columns={[
            { title: 'Code', dataIndex: 'code', key: 'code' },
            { title: 'Treatment', dataIndex: 'name', key: 'name' },
            { title: 'Lines', dataIndex: 'lines', key: 'lines', className: 'kw-num' },
            { title: 'Base', dataIndex: 'base', key: 'base', className: 'kw-num', render: (v: number) => money(v) },
            { title: 'Tax', dataIndex: 'tax', key: 'tax', className: 'kw-num', render: (v: number) => money(v) },
          ]}
        />
      </AdminSection>
    </AdminShell>
  );
}
