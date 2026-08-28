import { useState } from 'react';
import { DatePicker } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { StatStrip } from '../components/StatStrip';
import { DataTable, money } from '../components/DataTable';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useSegmentPl } from '../hooks/useAdmin';

/**
 * SEGMENTED P&L.
 *
 * Two things this screen says out loud rather than implying:
 *
 *  - IT IS GROSS PROFIT. No overhead is allocated to any segment, so the
 *    column is headed gross profit and the basis sentence sits above the table.
 *  - UNCLASSIFIED REVENUE IS A ROW. Revenue nobody has mapped appears as "Not
 *    classified" rather than being absorbed into a default segment, because it
 *    is the thing a clinic needs to see and fix.
 */
export function SegmentPlPage() {
  const { clinicId } = useClinicFilter();
  const [range, setRange] = useState<[string, string]>([
    dayjs().startOf('month').format('YYYY-MM-DD'),
    dayjs().format('YYYY-MM-DD'),
  ]);
  const { data, isLoading, isError, error } = useSegmentPl({ from: range[0], to: range[1], clinicId });

  return (
    <AdminShell
      error={firstError({ isError, error })}
      title="Segment P&L"
      subtitle="The clinic's service lines, as configuration rather than as five hardcoded reports."
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
      {data && !data.configured ? (
        <AdminNotice tone="warn">{data.message}</AdminNotice>
      ) : (
        <>
          <StatStrip
            stats={[
              { label: 'Revenue', value: money(data?.totals.revenue ?? 0) },
              { label: 'Direct cost', value: money(data?.totals.cost ?? 0) },
              { label: 'Gross profit', value: money(data?.totals.grossProfit ?? 0), tone: 'good' },
              {
                label: 'Margin',
                value: data?.totals.margin === null || data?.totals.margin === undefined ? '—' : `${data.totals.margin}%`,
              },
              {
                label: 'Not classified',
                value: money(data?.totals.unmappedRevenue ?? 0),
                tone: (data?.totals.unmappedRevenue ?? 0) > 0 ? 'warn' : 'good',
                hint: 'Revenue with no segment rule',
              },
            ]}
          />

          <AdminNotice>{data?.profitBasis}</AdminNotice>

          {(data?.linesWithoutCost ?? 0) > 0 ? (
            <AdminNotice tone="warn">
              {data?.linesWithoutCost} billed line(s) have no cost on record. They contribute revenue and no cost, so
              the margin above is optimistic by an unknown amount rather than wrong by a known one.
            </AdminNotice>
          ) : null}

          <AdminSection title="By segment" padded={false}>
            <DataTable
              rows={data?.segments}
              loading={isLoading}
              rowKey={(row) => row.segmentId ?? 'unmapped'}
              exportName="segment-pl"
              emptyText="No billed activity in this period"
              columns={[
                {
                  title: 'Segment',
                  dataIndex: 'name',
                  key: 'name',
                  render: (value: string, row) =>
                    row.segmentId === null ? <span className="kw-warn">{value}</span> : value,
                },
                { title: 'Code', dataIndex: 'code', key: 'code', optional: true },
                { title: 'Bills', dataIndex: 'bills', key: 'bills', className: 'kw-num' },
                { title: 'Patients', dataIndex: 'patients', key: 'patients', className: 'kw-num' },
                { title: 'Lines', dataIndex: 'lines', key: 'lines', className: 'kw-num', optional: true },
                {
                  title: 'Revenue',
                  dataIndex: 'revenue',
                  key: 'revenue',
                  className: 'kw-num',
                  sorter: (a, b) => a.revenue - b.revenue,
                  render: (v: number) => money(v),
                },
                { title: 'Direct cost', dataIndex: 'directCost', key: 'directCost', className: 'kw-num', render: (v: number) => money(v) },
                {
                  title: 'Gross profit',
                  dataIndex: 'grossProfit',
                  key: 'grossProfit',
                  className: 'kw-num',
                  render: (v: number) => <strong className={v < 0 ? 'kw-bad' : undefined}>{money(v)}</strong>,
                },
                {
                  title: 'Margin',
                  dataIndex: 'margin',
                  key: 'margin',
                  className: 'kw-num',
                  render: (value: number | null) => (value === null ? '—' : `${value}%`),
                },
              ]}
            />
          </AdminSection>
        </>
      )}
    </AdminShell>
  );
}
