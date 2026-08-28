import { useState } from 'react';
import { App, Button, DatePicker, Tag } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection, AdminShell } from '../components/AdminShell';
import { StatStrip } from '../components/StatStrip';
import { DataTable } from '../components/DataTable';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useApproveOvertime, useTimesheet } from '../hooks/useAdmin';

function hhmm(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—';
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/**
 * TIMESHEETS — what payroll will read, before payroll reads it.
 *
 * The unapproved-overtime column is the point of the screen: overtime that
 * nobody has approved is NOT paid, and showing it in its own column beside the
 * approved one is what stops that being a surprise on payday.
 */
export function TimesheetPage() {
  const { message } = App.useApp();
  const { clinicId } = useClinicFilter();
  const [range, setRange] = useState<[string, string]>([
    dayjs().startOf('month').format('YYYY-MM-DD'),
    dayjs().endOf('month').format('YYYY-MM-DD'),
  ]);
  const [expanded, setExpanded] = useState<string | undefined>();
  const { data, isLoading } = useTimesheet({ from: range[0], to: range[1], clinicId });
  const approveOvertime = useApproveOvertime();

  const staff = data?.staff ?? [];
  const unapproved = staff.reduce((total, row) => total + row.unapprovedOvertimeMinutes, 0);
  const missing = staff.reduce((total, row) => total + row.daysMissingPunch, 0);
  const selected = staff.find((row) => row.staffId === expanded);

  return (
    <AdminShell
      title="Timesheets"
      subtitle="What payroll will read. Overtime nobody has approved is shown separately and is not paid."
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
          { label: 'Staff with records', value: staff.length },
          { label: 'Hours worked', value: hhmm(staff.reduce((total, row) => total + row.workedMinutes, 0)) },
          {
            label: 'Approved overtime',
            value: hhmm(staff.reduce((total, row) => total + row.approvedOvertimeMinutes, 0)),
            tone: 'good',
          },
          {
            label: 'Unapproved overtime',
            value: hhmm(unapproved),
            tone: unapproved > 0 ? 'warn' : 'neutral',
            explain: 'Claimed but not approved. It will NOT appear on a payslip until somebody other than the claimant approves it.',
          },
          { label: 'Missing punches', value: missing, tone: missing > 0 ? 'bad' : 'good' },
        ]}
      />

      {unapproved > 0 ? (
        <AdminNotice tone="warn">
          {hhmm(unapproved)} of overtime is claimed and unapproved across this branch. A long day is not automatically
          overtime — approve what is genuine before the payroll run, or it will not be paid.
        </AdminNotice>
      ) : null}

      <AdminSection title="By person" padded={false}>
        <DataTable
          rows={staff}
          loading={isLoading}
          rowKey="staffId"
          exportName="timesheet"
          searchFields={['name' as never]}
          searchPlaceholder="Search staff…"
          emptyText="No attendance recorded in this period"
          emptyHint="Attendance is punches, not inferences — nobody has clocked in."
          onRow={(row) => ({ onClick: () => setExpanded(row.staffId === expanded ? undefined : row.staffId) })}
          columns={[
            { title: 'Name', dataIndex: 'name', key: 'name' },
            { title: 'Present', dataIndex: 'daysPresent', key: 'daysPresent', className: 'kw-num' },
            { title: 'Absent', dataIndex: 'daysAbsent', key: 'daysAbsent', className: 'kw-num' },
            { title: 'On leave', dataIndex: 'daysOnLeave', key: 'daysOnLeave', className: 'kw-num' },
            {
              title: 'Missing punch',
              dataIndex: 'daysMissingPunch',
              key: 'daysMissingPunch',
              className: 'kw-num',
              render: (count: number) => (count > 0 ? <span className="kw-bad">{count}</span> : '0'),
            },
            { title: 'Worked', dataIndex: 'workedMinutes', key: 'workedMinutes', className: 'kw-num', render: (v: number) => hhmm(v) },
            {
              title: 'Late',
              dataIndex: 'lateOccasions',
              key: 'lateOccasions',
              className: 'kw-num',
              render: (count: number, row) => (count === 0 ? '0' : <span className="kw-warn">{count}× ({hhmm(row.lateMinutes)})</span>),
            },
            {
              title: 'OT approved',
              dataIndex: 'approvedOvertimeHours',
              key: 'approvedOvertimeHours',
              className: 'kw-num',
              render: (v: number) => (v === 0 ? <span className="kw-muted">—</span> : <span className="kw-good">{v}h</span>),
            },
            {
              title: 'OT unapproved',
              dataIndex: 'unapprovedOvertimeHours',
              key: 'unapprovedOvertimeHours',
              className: 'kw-num',
              render: (v: number) => (v === 0 ? <span className="kw-muted">—</span> : <span className="kw-warn">{v}h</span>),
            },
          ]}
        />
      </AdminSection>

      {selected ? (
        <AdminSection title={`${selected.name} — day by day`} padded={false}>
          <DataTable
            rows={selected.days}
            rowKey="id"
            exportName={`timesheet-${selected.name}`}
            emptyText="No days"
            columns={[
              { title: 'Date', dataIndex: 'workDate', key: 'workDate', render: (v: string) => dayjs(v).format('ddd D MMM') },
              {
                title: 'Status',
                dataIndex: 'status',
                key: 'status',
                render: (value: string) => (
                  <Tag color={value === 'PRESENT' ? 'green' : value === 'LATE' ? 'gold' : value === 'MISSING_PUNCH' ? 'red' : 'default'}>
                    {value.replace(/_/g, ' ')}
                  </Tag>
                ),
              },
              { title: 'In', dataIndex: 'clockInAt', key: 'clockInAt', render: (v: string | null) => (v ? dayjs(v).format('HH:mm') : '—') },
              { title: 'Out', dataIndex: 'clockOutAt', key: 'clockOutAt', render: (v: string | null) => (v ? dayjs(v).format('HH:mm') : '—') },
              { title: 'Worked', dataIndex: 'workedMinutes', key: 'workedMinutes', className: 'kw-num', render: (v: number | null) => hhmm(v) },
              {
                title: 'Late',
                dataIndex: 'lateMinutes',
                key: 'lateMinutes',
                className: 'kw-num',
                render: (v: number | null) => (v ? <span className="kw-warn">{v}m</span> : '—'),
              },
              {
                title: 'Overtime',
                dataIndex: 'overtimeMinutes',
                key: 'overtimeMinutes',
                className: 'kw-num',
                render: (minutes: number, row) =>
                  minutes === 0 ? (
                    <span className="kw-muted">—</span>
                  ) : row.overtimeApproved ? (
                    <span className="kw-good">{hhmm(minutes)} approved</span>
                  ) : (
                    <span className="kw-warn">{hhmm(minutes)} unapproved</span>
                  ),
              },
              {
                title: 'Corrected',
                dataIndex: 'corrected',
                key: 'corrected',
                render: (value: boolean, row) => (value ? <Tag color="orange" title={row.correctionReason ?? ''}>Corrected</Tag> : '—'),
              },
              {
                title: '',
                key: 'action',
                noExport: true,
                render: (_: unknown, row) =>
                  row.overtimeMinutes > 0 && !row.overtimeApproved ? (
                    <Button
                      size="small"
                      type="link"
                      loading={approveOvertime.isPending}
                      onClick={() =>
                        approveOvertime.mutate(
                          { id: row.id },
                          {
                            onSuccess: () => message.success('Overtime approved'),
                            onError: (error: Error) => message.error(error.message),
                          },
                        )
                      }
                    >
                      Approve OT
                    </Button>
                  ) : null,
              },
            ]}
          />
        </AdminSection>
      ) : null}
    </AdminShell>
  );
}
