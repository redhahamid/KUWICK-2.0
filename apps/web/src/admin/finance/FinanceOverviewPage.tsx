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
  // Only worth a column when there is more than one branch in the answer;
  // a single-branch clinic does not need to be told which branch it is.
  const showBranchColumn = new Set(unreconciled.map((row) => row.clinicId)).size > 1;
  const aging = receivables.data?.aging;
  const agingCounts = receivables.data?.agingCounts ?? { current: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };

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
          // BRANCH AND DAY, because both are needed to name a drawer. Keyed by
          // the date alone, two branches with the same day open would collapse
          // into one row and one of them would silently never be closed.
          rowKey={(row) => `${row.clinicId}:${row.businessDate}`}
          emptyText="Every day with takings has been closed"
          emptyHint="Nothing here is the state you want."
          columns={[
            { title: 'Business date', dataIndex: 'businessDate', key: 'businessDate' },
            ...(showBranchColumn
              ? [{ title: 'Branch', dataIndex: 'clinicName', key: 'clinicName' }]
              : []),
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
              // The link carries the BRANCH as well as the date. Day-end
              // closing counts one drawer, so arriving there without knowing
              // whose drawer it is would be arriving nowhere.
              render: (_: unknown, row: { businessDate: string; clinicId: string }) => (
                <Button
                  size="small"
                  type="link"
                  onClick={() => navigate(`/admin/finance/day-end?date=${row.businessDate}&clinicId=${row.clinicId}`)}
                >
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
              // The amount is what a person chases, so the amount is what the
              // tile shows; the count still decides whether it is clean.
              { key: 'current', label: '0–30 days', count: agingCounts.current, display: money(aging?.current ?? 0), tone: 'info' },
              { key: 'd31', label: '31–60 days', count: agingCounts.d31_60, display: money(aging?.d31_60 ?? 0), tone: 'warn' },
              { key: 'd61', label: '61–90 days', count: agingCounts.d61_90, display: money(aging?.d61_90 ?? 0), tone: 'warn' },
              { key: 'd90', label: 'Over 90 days', count: agingCounts.d90_plus, display: money(aging?.d90_plus ?? 0), tone: 'bad' },
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
