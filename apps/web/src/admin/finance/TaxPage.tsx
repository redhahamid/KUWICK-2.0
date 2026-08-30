import { useState } from 'react';
import { DatePicker } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { StatStrip } from '../components/StatStrip';
import { DataTable, money } from '../components/DataTable';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useTaxReport } from '../hooks/useAdmin';
import type { TaxReport } from '../types';

const { RangePicker } = DatePicker;

type CodeRow = TaxReport['byCode'][number];
type InvoiceRow = TaxReport['byInvoice'][number];

/**
 * SERVICE TAX — summed from the tax each LINE actually carried.
 *
 * Not a percentage applied to a period total at reporting time. Every line
 * carries the code, the treatment and the rate that were in force on its own
 * invoice's date, snapshotted when the line was written; this screen adds
 * those up. A rate change halfway through a month is therefore handled by
 * arithmetic rather than by anybody remembering.
 *
 * NOT CLASSIFIED IS ITS OWN NUMBER, and the reason this screen exists rather
 * than a figure on the overview: revenue with no tax code is neither taxed nor
 * exempt, it is unmapped, and the difference is somebody's afternoon at the
 * catalogue rather than a filing position.
 */
export function TaxPage() {
  const { clinicId } = useClinicFilter();
  const [range, setRange] = useState<[string, string]>([
    dayjs().startOf('month').format('YYYY-MM-DD'),
    dayjs().format('YYYY-MM-DD'),
  ]);
  const { data, isLoading, isError, error } = useTaxReport({ from: range[0], to: range[1], clinicId });
  const summary = data?.summary;

  return (
    <AdminShell
      error={firstError({ isError, error })}
      title="Tax / SST"
      subtitle="Summed from the tax each line actually charged, at the rate in force on its own invoice date."
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
          { label: 'Taxable', value: money(summary?.taxable ?? 0), hint: `${summary?.lineCount ?? 0} lines` },
          { label: 'Service tax', value: money(summary?.tax ?? 0), tone: 'good' },
          { label: 'Gross taxable', value: money(summary?.grossTaxable ?? 0), tone: 'neutral' },
          { label: 'Zero rated', value: money(summary?.zeroRated ?? 0), tone: 'neutral' },
          { label: 'Exempt', value: money(summary?.exempt ?? 0), tone: 'neutral' },
          {
            label: 'Not classified',
            value: money(summary?.notClassified ?? 0),
            tone: (summary?.notClassified ?? 0) > 0 ? 'warn' : 'neutral',
            hint: 'no tax code on the line',
          },
        ]}
      />

      {(summary?.notClassified ?? 0) > 0 ? (
        <AdminNotice tone="warn">
          {money(summary?.notClassified ?? 0)} of revenue carries no tax classification. It is reported here as “not
          classified” rather than assumed exempt — an unmapped line and a deliberately exempt one are different facts,
          and only one of them is a filing position. Map the items and services to a tax code to resolve it.
        </AdminNotice>
      ) : null}

      <AdminSection title="By tax code" description="What each configured code collected in the period." padded={false}>
        <DataTable<CodeRow>
          rowKey="code"
          rows={data?.byCode}
          loading={isLoading}
          exportName="tax-by-code"
          emptyText="No taxable lines in this period"
          columns={[
            { title: 'Code', dataIndex: 'code', key: 'code' },
            { title: 'Name', dataIndex: 'name', key: 'name' },
            { title: 'Lines', dataIndex: 'lines', key: 'lines', className: 'kw-num' },
            { title: 'Base', dataIndex: 'base', key: 'base', className: 'kw-num', render: (v: number) => money(v) },
            {
              title: 'Tax',
              dataIndex: 'tax',
              key: 'tax',
              className: 'kw-num',
              render: (v: number) => <strong>{money(v)}</strong>,
            },
          ]}
        />
      </AdminSection>

      <AdminSection
        title="By invoice"
        description="Every invoice that carried tax, so a figure can be traced to the document behind it."
        padded={false}
      >
        <DataTable<InvoiceRow>
          rowKey="invoiceId"
          rows={data?.byInvoice}
          loading={isLoading}
          searchPlaceholder="Search invoice or patient…"
          searchFields={['invoiceNumber', 'patient']}
          exportName="tax-by-invoice"
          emptyText="No invoices carried tax in this period"
          scrollY={420}
          columns={[
            { title: 'Invoice', dataIndex: 'invoiceNumber', key: 'invoiceNumber' },
            {
              title: 'Date',
              dataIndex: 'date',
              key: 'date',
              render: (value: string) => dayjs(value).format('D MMM YY'),
            },
            { title: 'Patient', dataIndex: 'patient', key: 'patient' },
            { title: 'Base', dataIndex: 'base', key: 'base', className: 'kw-num', render: (v: number) => money(v) },
            {
              title: 'Tax',
              dataIndex: 'tax',
              key: 'tax',
              className: 'kw-num',
              render: (v: number) => <strong>{money(v)}</strong>,
            },
          ]}
        />
      </AdminSection>
    </AdminShell>
  );
}
