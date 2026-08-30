import { useState } from 'react';
import { DatePicker, Segmented } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { StatStrip } from '../components/StatStrip';
import { DataTable, DataTableTotals, money } from '../components/DataTable';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useProfitability } from '../hooks/useAdmin';
import type { ProfitabilityRow } from '../types';

const { RangePicker } = DatePicker;

/**
 * PROFITABILITY — what each drug and each procedure actually earns.
 *
 * The drug-movement report says what MOVED. The segmented P&L says which
 * service LINE earns. Neither answers the question an owner asks about one
 * thing: this medicine, this month, what did it bring in and what did it cost.
 *
 * Two refusals are the point of this screen, and both are visible on it:
 *
 *   CONTRIBUTION, NOT NET PROFIT. Rent, salaries, equipment and every other
 *   overhead are not allocated to a line item. The column says contribution
 *   and the note says why.
 *
 *   COST NOT CONFIGURED IS NOT ZERO COST. A procedure with no cost basis
 *   would otherwise report a 100% margin, which is the most flattering wrong
 *   number this system could produce. Those rows say COST NOT CONFIGURED,
 *   their margin is blank, and they are excluded from the totals — with the
 *   revenue they represent named, so the total is understood as partial.
 */
const RANKINGS = {
  revenue: { label: 'Highest revenue', sort: (a: ProfitabilityRow, b: ProfitabilityRow) => b.revenue - a.revenue },
  contribution: {
    label: 'Highest contribution',
    sort: (a: ProfitabilityRow, b: ProfitabilityRow) => (b.contribution ?? -Infinity) - (a.contribution ?? -Infinity),
  },
  margin: {
    label: 'Lowest margin',
    // Rows with no margin sort LAST, not first: an unknown is not a bad margin.
    sort: (a: ProfitabilityRow, b: ProfitabilityRow) => (a.margin ?? Infinity) - (b.margin ?? Infinity),
  },
  losses: {
    label: 'Loss making',
    sort: (a: ProfitabilityRow, b: ProfitabilityRow) => (a.contribution ?? Infinity) - (b.contribution ?? Infinity),
  },
  volume: { label: 'High volume', sort: (a: ProfitabilityRow, b: ProfitabilityRow) => b.quantity - a.quantity },
} as const;

type Ranking = keyof typeof RANKINGS;

export function ProfitabilityPage() {
  const { clinicId } = useClinicFilter();
  const [range, setRange] = useState<[string, string]>([
    dayjs().startOf('month').format('YYYY-MM-DD'),
    dayjs().format('YYYY-MM-DD'),
  ]);
  const [kind, setKind] = useState<'DRUG' | 'SERVICE'>('DRUG');
  const [ranking, setRanking] = useState<Ranking>('revenue');

  const report = useProfitability({ from: range[0], to: range[1], clinicId, kind });
  const totals = report.data?.totals;

  const rows = [...(report.data?.rows ?? [])].sort(RANKINGS[ranking].sort);
  const lossMaking = rows.filter((row) => row.contribution !== null && row.contribution < 0).length;

  return (
    <AdminShell
      error={firstError(report)}
      title="Profitability"
      subtitle="What each drug and each procedure earned, and what it cost to earn it."
      actions={
        <RangePicker
          size="small"
          allowClear={false}
          value={[dayjs(range[0]), dayjs(range[1])]}
          onChange={(dates) =>
            dates?.[0] && dates?.[1] && setRange([dates[0].format('YYYY-MM-DD'), dates[1].format('YYYY-MM-DD')])
          }
        />
      }
    >
      <StatStrip
        stats={[
          { label: 'Revenue', value: money(totals?.revenue ?? 0), hint: `${totals?.rows ?? 0} lines` },
          { label: 'Direct cost', value: money(totals?.directCost ?? 0), tone: 'neutral' },
          {
            label: 'Contribution',
            value: money(totals?.contribution ?? 0),
            tone: 'good',
            explain: report.data?.contributionNote,
          },
          {
            label: 'Margin',
            value: totals?.margin === null || totals?.margin === undefined ? '—' : `${totals.margin}%`,
            hint: 'on revenue that has a cost basis',
          },
          {
            label: 'Cost not configured',
            value: String(totals?.rowsWithoutCost ?? 0),
            tone: (totals?.rowsWithoutCost ?? 0) > 0 ? 'warn' : 'neutral',
            hint: `${money(totals?.revenueWithoutCost ?? 0)} of revenue`,
          },
          {
            label: 'Loss making',
            value: String(lossMaking),
            tone: lossMaking > 0 ? 'bad' : 'neutral',
            hint: 'contribution below zero',
          },
        ]}
      />

      <AdminNotice>{report.data?.contributionNote}</AdminNotice>
      <AdminNotice>{report.data?.costBasis}</AdminNotice>
      {(totals?.rowsWithoutCost ?? 0) > 0 ? (
        <AdminNotice tone="warn">
          {totals?.rowsWithoutCost} row(s) carrying {money(totals?.revenueWithoutCost ?? 0)} of revenue have no cost on
          record. They are shown as COST NOT CONFIGURED and left OUT of the totals above — counting them at zero cost
          would report them as pure profit, which is the one thing an unknown cost must never look like.
        </AdminNotice>
      ) : null}

      <AdminSection
        title={kind === 'DRUG' ? 'By drug' : 'By procedure or service'}
        description="Ranked by the question you are asking. A row with no cost basis never sorts as if it were profitable."
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Segmented
              size="small"
              value={kind}
              onChange={(value) => setKind(value as 'DRUG' | 'SERVICE')}
              options={[
                { label: 'Drugs', value: 'DRUG' },
                { label: 'Services & procedures', value: 'SERVICE' },
              ]}
            />
            <Segmented
              size="small"
              value={ranking}
              onChange={(value) => setRanking(value as Ranking)}
              options={Object.entries(RANKINGS).map(([value, entry]) => ({ label: entry.label, value }))}
            />
          </div>
        }
        padded={false}
      >
        <DataTable<ProfitabilityRow>
          rowKey={(row) => `${row.kind}:${row.referenceId ?? row.name}:${row.clinicId ?? ''}`}
          rows={rows}
          loading={report.isLoading}
          searchPlaceholder="Search item or service…"
          searchFields={['name', 'code', 'category', 'clinicName']}
          exportName={`profitability-${kind.toLowerCase()}`}
          emptyText={`Nothing ${kind === 'DRUG' ? 'dispensed' : 'performed'} in this period`}
          scrollY={520}
          columns={[
            { title: kind === 'DRUG' ? 'Item' : 'Service', dataIndex: 'name', key: 'name' },
            { title: 'Code', dataIndex: 'code', key: 'code', optional: true },
            { title: 'Category', dataIndex: 'category', key: 'category' },
            { title: 'Branch', dataIndex: 'clinicName', key: 'clinicName', optional: true },
            {
              title: kind === 'DRUG' ? 'Units' : 'Performed',
              dataIndex: 'quantity',
              key: 'quantity',
              className: 'kw-num',
            },
            { title: 'Invoices', dataIndex: 'invoices', key: 'invoices', className: 'kw-num', optional: true },
            {
              title: 'Revenue',
              dataIndex: 'revenue',
              key: 'revenue',
              className: 'kw-num',
              render: (value: number) => money(value),
            },
            {
              title: 'Direct cost',
              dataIndex: 'directCost',
              key: 'directCost',
              className: 'kw-num',
              render: (value: number | null) =>
                value === null ? <span className="kw-warn">COST NOT CONFIGURED</span> : money(value),
            },
            {
              title: 'Contribution',
              dataIndex: 'contribution',
              key: 'contribution',
              className: 'kw-num',
              render: (value: number | null) =>
                value === null ? (
                  <span className="kw-muted">—</span>
                ) : (
                  <strong className={value < 0 ? 'kw-bad' : undefined}>{money(value)}</strong>
                ),
            },
            {
              title: 'Margin',
              dataIndex: 'margin',
              key: 'margin',
              className: 'kw-num',
              render: (value: number | null) =>
                value === null ? (
                  <span className="kw-muted">—</span>
                ) : (
                  <span className={value < 0 ? 'kw-bad' : value < 20 ? 'kw-warn' : undefined}>{value}%</span>
                ),
            },
          ]}
          summary={(shown) => (
            <DataTableTotals
              count={shown.length}
              total={shown.reduce((sum, row) => sum + (row as ProfitabilityRow).revenue, 0)}
              label="revenue in view"
            />
          )}
        />
      </AdminSection>
    </AdminShell>
  );
}
