import { useState } from 'react';
import { DatePicker, Select, Tag } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { StatStrip } from '../components/StatStrip';
import { DataTable, money } from '../components/DataTable';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useProgrammeDashboard, useProgrammes } from '../hooks/useAdmin';

/**
 * PROGRAMMES — NCD, weight management, and whatever else a clinic runs.
 *
 * THE THING THIS SCREEN REFUSES TO DO: show a clinical control rate it cannot
 * compute. Every measure the dashboard would like to present and cannot is
 * listed by name with the reason, in a panel of its own, because a missing
 * number that nobody mentions is indistinguishable from a number nobody
 * measured.
 */
export function ProgrammesPage() {
  const { clinicId } = useClinicFilter();
  const programmes = useProgrammes();
  const [selected, setSelected] = useState<string | undefined>();
  const [range, setRange] = useState<[string, string]>([
    dayjs().startOf('month').format('YYYY-MM-DD'),
    dayjs().format('YYYY-MM-DD'),
  ]);
  const active = selected ?? programmes.data?.[0]?.id;
  const dashboard = useProgrammeDashboard(active, { from: range[0], to: range[1], clinicId });

  return (
    <AdminShell
      error={firstError(programmes, dashboard)}
      title="Programmes"
      subtitle="Enrolment, activity and contribution for each programme the clinic runs."
      actions={
        <>
          <Select
            size="small"
            style={{ minWidth: 200 }}
            value={active}
            placeholder="Select a programme"
            onChange={setSelected}
            options={programmes.data?.map((programme) => ({ value: programme.id, label: programme.name }))}
          />
          <DatePicker.RangePicker
            allowClear={false}
            size="small"
            value={[dayjs(range[0]), dayjs(range[1])]}
            onChange={(dates) =>
              dates?.[0] && dates?.[1] && setRange([dates[0].format('YYYY-MM-DD'), dates[1].format('YYYY-MM-DD')])
            }
          />
        </>
      }
    >
      {(programmes.data?.length ?? 0) === 0 ? (
        <AdminNotice tone="warn">
          No programmes are configured. A programme is what turns "our NCD patients" into a group the system can count —
          add one with its qualifying services and items.
        </AdminNotice>
      ) : null}

      <StatStrip
        stats={[
          { label: 'Active patients', value: dashboard.data?.activePatients ?? 0 },
          { label: 'New enrolments', value: dashboard.data?.newEnrolments ?? 0, tone: 'good', hint: 'in this period' },
          { label: 'Procedures', value: dashboard.data?.activity.proceduresCompleted ?? 0 },
          { label: 'Units dispensed', value: dashboard.data?.activity.unitsDispensed ?? 0 },
          { label: 'Revenue', value: money(dashboard.data?.financials.revenue ?? 0) },
          {
            label: 'Gross profit',
            value: money(dashboard.data?.financials.grossProfit ?? 0),
            tone: 'good',
            explain: dashboard.data?.financials.basis,
          },
        ]}
      />

      <div className="kw-adminGrid kw-adminGrid--2">
        <AdminSection title="What was dispensed" padded={false}>
          <DataTable
            rows={dashboard.data?.activity.byItem}
            loading={dashboard.isLoading}
            rowKey="itemId"
            exportName="programme-dispensing"
            emptyText="Nothing dispensed against this programme in the period"
            columns={[
              { title: 'Item', dataIndex: 'name', key: 'name' },
              { title: 'Units', dataIndex: 'quantity', key: 'quantity', className: 'kw-num' },
            ]}
          />
        </AdminSection>

        <AdminSection
          title="What this dashboard cannot tell you"
          description="Listed by name, because a missing number nobody mentions looks exactly like a number nobody measured."
        >
          {dashboard.data?.unavailableMeasures.map((measure) => (
            <div key={measure.measure} className="kw-unavailable">
              <strong>{measure.measure}</strong>
              <p>{measure.reason}</p>
            </div>
          ))}
        </AdminSection>
      </div>

      <AdminSection title="Enrolled patients" padded={false}>
        <DataTable
          rows={dashboard.data?.patients}
          loading={dashboard.isLoading}
          rowKey="patientId"
          exportName="programme-patients"
          searchFields={['name' as never]}
          searchPlaceholder="Search patient…"
          emptyText="Nobody is enrolled"
          scrollY={400}
          columns={[
            { title: 'Patient', dataIndex: 'name', key: 'name' },
            { title: 'Gender', dataIndex: 'gender', key: 'gender', optional: true },
            {
              title: 'Enrolled',
              dataIndex: 'enrolledAt',
              key: 'enrolledAt',
              render: (value: string) => dayjs(value).format('D MMM YY'),
            },
            {
              title: 'Last visit',
              dataIndex: 'lastVisitAt',
              key: 'lastVisitAt',
              render: (value: string | null) =>
                value ? (
                  <span className={dayjs().diff(dayjs(value), 'day') > 90 ? 'kw-warn' : undefined}>
                    {dayjs(value).format('D MMM YY')} ({dayjs().diff(dayjs(value), 'day')}d ago)
                  </span>
                ) : (
                  <Tag color="red">Never</Tag>
                ),
            },
          ]}
        />
      </AdminSection>
    </AdminShell>
  );
}
