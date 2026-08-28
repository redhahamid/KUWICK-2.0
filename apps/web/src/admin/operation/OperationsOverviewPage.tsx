import { useState } from 'react';
import { Button, DatePicker } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { StatStrip } from '../components/StatStrip';
import { DataTable, money } from '../components/DataTable';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useOperationsOverview } from '../hooks/useAdmin';

type Preset = 'TODAY' | 'MONTH' | 'QUARTER' | 'CUSTOM';

/**
 * OPERATIONS — "how is the clinic performing?"
 *
 * The one thing this screen is careful about beyond arithmetic: the doctor
 * table is headed "Billed under doctor", and the sentence explaining what that
 * is and is not sits directly above it. Revenue attributed to a doctor is not
 * a doctor's income, and a screen that lets a reader believe otherwise causes
 * an argument the clinic did not need to have.
 */
export function OperationsOverviewPage() {
  const { clinicId } = useClinicFilter();
  const [preset, setPreset] = useState<Preset>('MONTH');
  const [range, setRange] = useState<[string, string]>([
    dayjs().startOf('month').format('YYYY-MM-DD'),
    dayjs().format('YYYY-MM-DD'),
  ]);

  const { data, isLoading, isError, error } = useOperationsOverview({
    clinicId,
    preset,
    from: preset === 'CUSTOM' ? range[0] : undefined,
    to: preset === 'CUSTOM' ? range[1] : undefined,
  });

  const kpis = data?.kpis;
  const peakHour = data?.byHour.reduce((best, hour) => (hour.visits > best.visits ? hour : best), { hour: 0, visits: 0 });

  return (
    <AdminShell
      error={firstError({ isError, error })}
      title="Operations"
      subtitle={data ? `${data.period.label} · ${data.period.from} to ${data.period.to}` : 'How is the clinic performing?'}
      actions={
        <>
          <Button.Group size="small">
            {(['TODAY', 'MONTH', 'QUARTER', 'CUSTOM'] as const).map((value) => (
              <Button key={value} type={preset === value ? 'primary' : 'default'} onClick={() => setPreset(value)}>
                {value === 'TODAY' ? 'Today' : value === 'MONTH' ? 'This month' : value === 'QUARTER' ? 'This quarter' : 'Custom'}
              </Button>
            ))}
          </Button.Group>
          {preset === 'CUSTOM' ? (
            <DatePicker.RangePicker
              allowClear={false}
              size="small"
              value={[dayjs(range[0]), dayjs(range[1])]}
              onChange={(dates) =>
                dates?.[0] && dates?.[1] && setRange([dates[0].format('YYYY-MM-DD'), dates[1].format('YYYY-MM-DD')])
              }
            />
          ) : null}
        </>
      }
    >
      <StatStrip
        stats={[
          { label: 'Visits', value: kpis?.visits ?? 0 },
          { label: 'Patients', value: kpis?.patients ?? 0, hint: `${kpis?.newPatients ?? 0} new · ${kpis?.returningPatients ?? 0} returning` },
          { label: 'Revenue', value: money(kpis?.revenue ?? 0), tone: 'good' },
          { label: 'Panel portion', value: money(kpis?.panelPortion ?? 0) },
          { label: 'Average bill', value: money(kpis?.averageBillPerPatient ?? 0), hint: 'per patient' },
          {
            label: 'Average wait',
            value: kpis?.averageWaitMinutes === null || kpis?.averageWaitMinutes === undefined ? '—' : `${kpis.averageWaitMinutes} min`,
            hint:
              kpis?.waitCoverage === null || kpis?.waitCoverage === undefined
                ? undefined
                : `from ${kpis.waitSampleSize} visits (${kpis.waitCoverage}%)`,
            explain:
              'Measured only where both a check-in and a called-time exist. Visits missing either are excluded rather than counted as a zero wait, which would drag the average down for a data gap.',
          },
        ]}
      />

      <div className="kw-adminGrid kw-adminGrid--2">
        <AdminSection title="Where patients came from">
          <StatStrip
            stats={[
              { label: 'Booked appointments', value: data?.source.appointment ?? 0 },
              { label: 'Walk-ins', value: data?.source.walkIn ?? 0 },
              { label: 'Busiest hour', value: peakHour ? `${String(peakHour.hour).padStart(2, '0')}:00` : '—', hint: `${peakHour?.visits ?? 0} visits` },
            ]}
          />
        </AdminSection>

        <AdminSection title="New vs returning">
          <StatStrip
            stats={[
              { label: 'New patients', value: kpis?.newPatients ?? 0, tone: 'good' },
              { label: 'Returning', value: kpis?.returningPatients ?? 0 },
              {
                label: 'New share',
                value: kpis && kpis.patients > 0 ? `${Math.round((kpis.newPatients / kpis.patients) * 100)}%` : '—',
                explain: 'A patient is NEW when this period contains their first visit ever — not their first visit in the period.',
              },
            ]}
          />
        </AdminSection>
      </div>

      <AdminSection title="Activity by day" padded={false}>
        <DataTable
          rows={data?.byDay}
          loading={isLoading}
          rowKey="date"
          exportName="operations-by-day"
          emptyText="No activity in this period"
          scrollY={280}
          columns={[
            { title: 'Date', dataIndex: 'date', key: 'date', render: (value: string) => dayjs(value).format('ddd D MMM') },
            { title: 'Visits', dataIndex: 'visits', key: 'visits', className: 'kw-num' },
            { title: 'Revenue', dataIndex: 'revenue', key: 'revenue', className: 'kw-num', render: (v: number) => money(v) },
          ]}
        />
      </AdminSection>

      <AdminSection title="Doctor productivity" padded={false}>
        <div style={{ padding: '12px 16px 0' }}>
          <AdminNotice>{data?.doctorProductivityNote}</AdminNotice>
        </div>
        <DataTable
          rows={data?.byDoctor}
          loading={isLoading}
          rowKey="staffId"
          exportName="doctor-productivity"
          searchFields={['name' as never]}
          emptyText="No visits attributed to a doctor in this period"
          columns={[
            { title: 'Doctor', dataIndex: 'name', key: 'name' },
            { title: 'Visits', dataIndex: 'visits', key: 'visits', className: 'kw-num', sorter: (a, b) => a.visits - b.visits },
            {
              title: 'Billed under doctor',
              dataIndex: 'billedUnderDoctor',
              key: 'billedUnderDoctor',
              className: 'kw-num',
              sorter: (a, b) => a.billedUnderDoctor - b.billedUnderDoctor,
              defaultSortOrder: 'descend',
              render: (v: number) => money(v),
            },
            {
              title: 'Average bill per visit',
              dataIndex: 'averageBillPerVisit',
              key: 'averageBillPerVisit',
              className: 'kw-num',
              render: (v: number) => money(v),
            },
          ]}
        />
      </AdminSection>
    </AdminShell>
  );
}
