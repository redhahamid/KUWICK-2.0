import { useState } from 'react';
import { App, Button, DatePicker, Tag } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { StatStrip } from '../components/StatStrip';
import { DataTable, money } from '../components/DataTable';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useCalculateIncentives, useIncentiveRules, useIncentiveRun, useIncentiveRuns } from '../hooks/useAdmin';

/**
 * DOCTOR INCENTIVES.
 *
 * The rule VERSION is on every row, because "why is my number different from
 * last month" is the question this screen exists to answer. A rule is never
 * edited in place — a change is a new version with a new effective date — so a
 * paid incentive is never recalculated with today's rules.
 */
export function IncentivesPage() {
  const { message } = App.useApp();
  const { clinicId } = useClinicFilter();
  const runs = useIncentiveRuns({ clinicId });
  const rules = useIncentiveRules();
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const detail = useIncentiveRun(selectedId);
  const calculate = useCalculateIncentives();
  const [period, setPeriod] = useState(dayjs().format('YYYY-MM'));

  return (
    <AdminShell
      error={firstError(runs, rules, detail)}
      title="Doctor Incentives"
      subtitle="Threshold commissions and per-procedure rates, versioned so a paid incentive is never recalculated with today's rules."
      actions={
        <>
          <DatePicker
            picker="month"
            size="small"
            allowClear={false}
            value={dayjs(period)}
            onChange={(value) => value && setPeriod(value.format('YYYY-MM'))}
          />
          <Button
            size="small"
            type="primary"
            loading={calculate.isPending}
            onClick={() =>
              calculate.mutate(
                { period, clinicId },
                {
                  onSuccess: (result) => {
                    message.success('Calculated');
                    setSelectedId((result as { id: string }).id);
                  },
                  onError: (error: Error) => message.error(error.message),
                },
              )
            }
          >
            Calculate {period}
          </Button>
        </>
      }
    >
      {(rules.data?.length ?? 0) === 0 ? (
        <AdminNotice tone="warn">
          No incentive rules are configured, so a calculation will produce nothing. A rule states a threshold, a flat
          amount and a percentage of the excess — or a rate per qualifying procedure, which may differ for a resident
          and a locum.
        </AdminNotice>
      ) : null}

      <AdminSection title="Incentive runs" padded={false}>
        <DataTable
          rows={runs.data}
          loading={runs.isLoading}
          rowKey="id"
          emptyText="No incentive runs"
          onRow={(row) => ({ onClick: () => setSelectedId(row.id) })}
          columns={[
            { title: 'Period', dataIndex: 'period', key: 'period', defaultSortOrder: 'descend', sorter: (a, b) => a.period.localeCompare(b.period) },
            { title: 'Branch', dataIndex: 'clinicName', key: 'clinicName' },
            {
              title: 'Status',
              dataIndex: 'status',
              key: 'status',
              render: (value: string) => (
                <Tag color={value === 'APPROVED' || value === 'PAID' ? 'green' : value === 'CALCULATED' ? 'blue' : 'default'}>
                  {value}
                </Tag>
              ),
            },
            { title: 'Doctors', dataIndex: 'doctors', key: 'doctors', className: 'kw-num' },
            { title: 'Total', dataIndex: 'totalAmount', key: 'totalAmount', className: 'kw-num', render: (v: number) => <strong>{money(v)}</strong> },
            {
              title: 'Calculated',
              dataIndex: 'calculatedAt',
              key: 'calculatedAt',
              render: (value: string | null) => (value ? dayjs(value).format('D MMM YY') : '—'),
            },
          ]}
        />
      </AdminSection>

      {detail.data ? (
        <AdminSection title={`${detail.data.period} · ${detail.data.clinicName}`} padded={false}>
          <div style={{ padding: '12px 16px 0' }}>
            <StatStrip
              stats={[
                { label: 'Doctors', value: detail.data.results.length },
                { label: 'Total', value: money(detail.data.totalAmount), tone: 'good' },
              ]}
            />
          </div>
          <DataTable
            rows={detail.data.results}
            rowKey="id"
            exportName={`incentives-${detail.data.period}`}
            emptyText="No incentive earned in this period"
            columns={[
              { title: 'Doctor', dataIndex: 'name', key: 'name' },
              { title: 'Rule', dataIndex: 'ruleName', key: 'ruleName' },
              {
                title: 'Version',
                dataIndex: 'ruleVersion',
                key: 'ruleVersion',
                className: 'kw-num',
                render: (value: number) => <Tag>v{value}</Tag>,
              },
              { title: 'Type', dataIndex: 'ruleType', key: 'ruleType', optional: true },
              {
                title: 'Basis',
                dataIndex: 'basisAmount',
                key: 'basisAmount',
                className: 'kw-num',
                render: (value: number, row) => (row.ruleType === 'PROCEDURE' ? `${row.basisCount} procedures` : money(value)),
              },
              {
                title: 'Earned',
                dataIndex: 'amount',
                key: 'amount',
                className: 'kw-num',
                sorter: (a, b) => a.amount - b.amount,
                defaultSortOrder: 'descend',
                render: (v: number) => <strong>{money(v)}</strong>,
              },
              {
                title: 'Working',
                dataIndex: 'calculation',
                key: 'calculation',
                ellipsis: true,
                render: (value: Record<string, unknown> | null) =>
                  value ? <span className="kw-muted">{String(value.explanation ?? '')}</span> : '—',
              },
            ]}
          />
        </AdminSection>
      ) : null}
    </AdminShell>
  );
}
