import { useMemo, useState } from 'react';
import { App, Button, DatePicker, Select } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { TIME_VIEWS, WorkAreaTabs } from '../components/WorkAreaTabs';
import { StatStrip } from '../components/StatStrip';
import { DataTable, exportRowsAsCsv } from '../components/DataTable';
import { FilterBar, Filter } from '../components/FilterBar';
import { PersonCell } from '../components/Person';
import { StatusChip, humanise } from '../components/Chip';
import { DetailDrawer, DrawerSection } from '../components/DetailDrawer';
import { EmptyState } from '../components/Panel';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useRosterRange } from '../../appointment/hooks/useRoster';
import { useApproveOvertime, useCorrectionRequests, useDecideCorrection, useTimesheet } from '../hooks/useAdmin';
import { formatClinicTime } from '../../clinical/clinicTime';
import type { TimesheetReport } from '../types';

type StaffRow = TimesheetReport['staff'][number];

function hhmm(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—';
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/**
 * ATTENDANCE — the operational workspace, in the reference sheet's own order:
 * the four Time & Leave views, then period / branch / status / Export, then
 * five summary figures, then the people.
 *
 * THE UNAPPROVED-OVERTIME COLUMN IS STILL THE POINT of the screen. Overtime
 * nobody has approved is NOT paid, and showing it beside the approved one is
 * what stops that being a surprise on payday.
 *
 * THE DAY-BY-DAY DETAIL IS A DRAWER NOW. It used to be a second table that
 * appeared BELOW the first when you clicked a row, so opening somebody's days
 * pushed the list you were comparing them against off the bottom of the
 * screen. The drawer leaves the list where it is.
 */
export function TimesheetPage() {
  const { message } = App.useApp();
  const { clinicId, setClinicId, clinics, showSelector } = useClinicFilter();
  const [range, setRange] = useState<[string, string]>([
    dayjs().startOf('month').format('YYYY-MM-DD'),
    dayjs().endOf('month').format('YYYY-MM-DD'),
  ]);
  const [filter, setFilter] = useState('ALL');
  const [open, setOpen] = useState<string | undefined>();
  const { data, isLoading, isError, error } = useTimesheet({ from: range[0], to: range[1], clinicId });
  const approveOvertime = useApproveOvertime();
  const corrections = useCorrectionRequests(clinicId);
  const decideCorrection = useDecideCorrection();
  // SCHEDULED comes from the roster, which is one branch's — so on "All
  // branches" this reads "—" rather than a number that silently means one
  // branch. See the tooltip on the tile.
  const roster = useRosterRange(clinicId, range[0], range[1]);

  const staff = data?.staff ?? [];
  const unapproved = staff.reduce((total, row) => total + row.unapprovedOvertimeMinutes, 0);
  const missing = staff.reduce((total, row) => total + row.daysMissingPunch, 0);
  const present = staff.reduce((total, row) => total + row.daysPresent, 0);
  const late = staff.reduce((total, row) => total + row.lateOccasions, 0);
  const selected = staff.find((row) => row.staffId === open);

  const rows = useMemo(
    () =>
      staff.filter((row) => {
        if (filter === 'LATE') return row.lateOccasions > 0;
        if (filter === 'MISSING') return row.daysMissingPunch > 0;
        if (filter === 'OT') return row.unapprovedOvertimeMinutes > 0;
        if (filter === 'ABSENT') return row.daysAbsent > 0;
        return true;
      }),
    [staff, filter],
  );

  return (
    <AdminShell
      error={firstError({ isError, error })}
      title="Attendance"
      subtitle="What payroll will read. Overtime nobody has approved is not paid."
    >
      <WorkAreaTabs views={TIME_VIEWS} />

      <FilterBar
        right={
          <Button
            size="small"
            onClick={() =>
              exportRowsAsCsv(`attendance-${range[0]}-to-${range[1]}`, rows, [
                { title: 'Name', dataIndex: 'name', key: 'name' },
                { title: 'Present', dataIndex: 'daysPresent', key: 'daysPresent' },
                { title: 'Absent', dataIndex: 'daysAbsent', key: 'daysAbsent' },
                { title: 'On leave', dataIndex: 'daysOnLeave', key: 'daysOnLeave' },
                { title: 'Missing punch', dataIndex: 'daysMissingPunch', key: 'daysMissingPunch' },
                { title: 'Worked hours', dataIndex: 'workedHours', key: 'workedHours' },
                { title: 'Late occasions', dataIndex: 'lateOccasions', key: 'lateOccasions' },
                { title: 'OT approved (h)', dataIndex: 'approvedOvertimeHours', key: 'approvedOvertimeHours' },
                { title: 'OT pending (h)', dataIndex: 'unapprovedOvertimeHours', key: 'unapprovedOvertimeHours' },
              ])
            }
          >
            Export
          </Button>
        }
      >
        <Filter label="Period">
          <DatePicker.RangePicker
            allowClear={false}
            size="small"
            value={[dayjs(range[0]), dayjs(range[1])]}
            onChange={(dates) =>
              dates?.[0] && dates?.[1] && setRange([dates[0].format('YYYY-MM-DD'), dates[1].format('YYYY-MM-DD')])
            }
          />
        </Filter>
        {showSelector ? (
          <Filter label="Branch">
            <Select
              size="small"
              style={{ width: 180 }}
              allowClear
              placeholder="All branches"
              value={clinicId}
              onChange={(value) => setClinicId(value)}
              options={(clinics ?? []).map((clinic) => ({ value: clinic.id, label: clinic.name }))}
            />
          </Filter>
        ) : null}
        <Filter label="Status">
          <Select
            size="small"
            style={{ width: 180 }}
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'ALL', label: 'Everybody' },
              { value: 'LATE', label: 'Late at least once' },
              { value: 'MISSING', label: 'Missing a punch' },
              { value: 'OT', label: 'Overtime pending' },
              { value: 'ABSENT', label: 'Absent at least once' },
            ]}
          />
        </Filter>
      </FilterBar>

      <StatStrip
        stats={[
          {
            label: 'Scheduled shifts',
            // A ROSTER BELONGS TO ONE BRANCH, so this figure only exists once
            // one is chosen. The dash carries the reason rather than looking
            // like a figure that failed to load.
            value: clinicId ? (roster.data?.length ?? 0) : '—',
            hint: clinicId ? 'from the roster' : 'choose a branch',
            explain: clinicId
              ? 'From the roster — the one scheduling domain. Attendance reads it and never writes to it.'
              : 'A roster is drawn for one branch at a time, so shifts cannot be counted across all of them here.',
          },
          { label: 'Days present', value: present, tone: 'good' },
          { label: 'Late', value: late, tone: late > 0 ? 'warn' : 'neutral', hint: `${staff.length} staff with records` },
          { label: 'Missing punch', value: missing, tone: missing > 0 ? 'bad' : 'good' },
          {
            label: 'OT pending',
            value: hhmm(unapproved),
            tone: unapproved > 0 ? 'warn' : 'neutral',
            explain: 'Claimed but not approved. It will NOT appear on a payslip until somebody approves it.',
          },
        ]}
      />

      {/*
        * WHAT STAFF HAVE ASKED TO HAVE PUT RIGHT.
        *
        * Above the sheet when there is any, because it is the only thing here
        * that somebody is waiting on. Approving one applies the correction
        * through the ordinary path — the original punch survives and the
        * approver is named — so this is a decision, not an edit.
        */}
      {(corrections.data?.length ?? 0) > 0 ? (
        <AdminSection
          title="Attendance fixes requested"
          description="Nothing changes until you decide, and the original stays on the record either way."
          padded={false}
        >
          <DataTable
            rows={corrections.data}
            loading={corrections.isLoading}
            rowKey="id"
            emptyText="Nothing waiting"
            columns={[
              {
                title: 'Who',
                dataIndex: 'staffName',
                key: 'staffName',
                render: (value: string, row) => <PersonCell name={value} meta={dayjs(row.record.workDate).format('ddd D MMM')} />,
              },
              {
                title: 'Recorded',
                key: 'recorded',
                render: (_: unknown, row) =>
                  `${row.record.clockInAt ? formatClinicTime(row.record.clockInAt) : '—'} → ${
                    row.record.clockOutAt ? formatClinicTime(row.record.clockOutAt) : '—'
                  }`,
              },
              {
                title: 'Asked for',
                key: 'asked',
                render: (_: unknown, row) =>
                  `${row.requestedClockInAt ? formatClinicTime(row.requestedClockInAt) : 'unchanged'} → ${
                    row.requestedClockOutAt ? formatClinicTime(row.requestedClockOutAt) : 'unchanged'
                  }`,
              },
              { title: 'Why', dataIndex: 'reason', key: 'reason' },
              {
                title: '',
                key: 'decide',
                width: 160,
                noExport: true,
                render: (_: unknown, row) => (
                  <span style={{ display: 'flex', gap: 6 }}>
                    <Button
                      size="small"
                      type="primary"
                      loading={decideCorrection.isPending}
                      onClick={async () => {
                        try {
                          await decideCorrection.mutateAsync({ id: row.id, approve: true });
                          message.success(`${row.staffName}'s ${row.record.workDate} corrected.`);
                        } catch (error) {
                          message.error(error instanceof Error ? error.message : 'Could not apply that.');
                        }
                      }}
                    >
                      Approve
                    </Button>
                    <Button
                      size="small"
                      onClick={async () => {
                        try {
                          await decideCorrection.mutateAsync({ id: row.id, approve: false });
                          message.success('Refused, and the employee will see why.');
                        } catch (error) {
                          message.error(error instanceof Error ? error.message : 'Could not record that.');
                        }
                      }}
                    >
                      Refuse
                    </Button>
                  </span>
                ),
              },
            ]}
          />
        </AdminSection>
      ) : null}

      {unapproved > 0 ? (
        <AdminNotice tone="warn">
          {hhmm(unapproved)} of overtime is claimed and unapproved. A long day is not automatically overtime —
          approve what is genuine before the payroll run, or it will not be paid.
        </AdminNotice>
      ) : null}

      <AdminSection padded={false}>
        <DataTable<StaffRow>
          rows={rows}
          loading={isLoading}
          rowKey="staffId"
          searchFields={['name' as never]}
          searchPlaceholder="Search staff…"
          emptyText={filter === 'ALL' ? 'No attendance recorded in this period' : 'Nobody matches that filter'}
          emptyHint={filter === 'ALL' ? 'Attendance is punches, not inferences — nobody has clocked in.' : undefined}
          scrollY={520}
          onRow={(row) => ({ onClick: () => setOpen(row.staffId) })}
          columns={[
            {
              title: 'Employee',
              dataIndex: 'name',
              key: 'name',
              width: 220,
              sorter: (a, b) => a.name.localeCompare(b.name),
              render: (value: string, row) => (
                <PersonCell name={value} meta={`${row.days.length} day${row.days.length === 1 ? '' : 's'} recorded`} />
              ),
            },
            { title: 'Present', dataIndex: 'daysPresent', key: 'daysPresent', width: 90, className: 'kw-num' },
            { title: 'Absent', dataIndex: 'daysAbsent', key: 'daysAbsent', width: 90, className: 'kw-num' },
            { title: 'On leave', dataIndex: 'daysOnLeave', key: 'daysOnLeave', width: 95, className: 'kw-num' },
            {
              title: 'Missing punch',
              dataIndex: 'daysMissingPunch',
              key: 'daysMissingPunch',
              width: 125,
              className: 'kw-num',
              render: (count: number) => (count > 0 ? <span className="kw-bad">{count}</span> : <span className="kw-muted">0</span>),
            },
            {
              title: 'Worked',
              dataIndex: 'workedMinutes',
              key: 'workedMinutes',
              width: 105,
              className: 'kw-num',
              render: (value: number) => hhmm(value),
            },
            {
              title: 'Late',
              dataIndex: 'lateOccasions',
              key: 'lateOccasions',
              width: 130,
              className: 'kw-num',
              render: (count: number, row) =>
                count === 0 ? (
                  <span className="kw-muted">0</span>
                ) : (
                  <span className="kw-warn">
                    {count}× ({hhmm(row.lateMinutes)})
                  </span>
                ),
            },
            {
              title: 'OT approved',
              dataIndex: 'approvedOvertimeHours',
              key: 'approvedOvertimeHours',
              width: 115,
              className: 'kw-num',
              render: (value: number) =>
                value === 0 ? <span className="kw-muted">—</span> : <span className="kw-good">{value}h</span>,
            },
            {
              title: 'OT pending',
              dataIndex: 'unapprovedOvertimeHours',
              key: 'unapprovedOvertimeHours',
              width: 110,
              className: 'kw-num',
              render: (value: number) =>
                value === 0 ? <span className="kw-muted">—</span> : <span className="kw-warn">{value}h</span>,
            },
            {
              title: '',
              key: 'action',
              width: 90,
              noExport: true,
              render: () => (
                <Button size="small" type="text" className="kw-rowAction">
                  View →
                </Button>
              ),
            },
          ]}
        />
      </AdminSection>

      <DetailDrawer
        open={Boolean(selected)}
        onClose={() => setOpen(undefined)}
        name={selected?.name ?? ''}
        subtitle={`${dayjs(range[0]).format('D MMM')} – ${dayjs(range[1]).format('D MMM YYYY')}`}
        width={560}
        tags={
          selected ? (
            <>
              <StatusChip tone="ok" dot>
                {selected.daysPresent} present
              </StatusChip>
              {selected.daysAbsent > 0 ? <StatusChip tone="blocked" dot>{selected.daysAbsent} absent</StatusChip> : null}
              {selected.daysMissingPunch > 0 ? (
                <StatusChip tone="blocked" dot>
                  {selected.daysMissingPunch} missing punch
                </StatusChip>
              ) : null}
              {selected.unapprovedOvertimeMinutes > 0 ? (
                <StatusChip tone="attention" dot>
                  {selected.unapprovedOvertimeHours}h overtime pending
                </StatusChip>
              ) : null}
            </>
          ) : null
        }
      >
        {selected ? (
          <DrawerSection title="Day by day">
            {selected.days.length === 0 ? (
              <EmptyState title="No days recorded in this period" />
            ) : (
              <div className="kw-dayList">
                {selected.days.map((day) => (
                  <div key={day.id} className="kw-dayRow">
                    <div className="kw-dayRow__date">
                      <span className="kw-dayRow__dow">{dayjs(day.workDate).format('ddd')}</span>
                      <span className="kw-dayRow__num">{dayjs(day.workDate).format('D MMM')}</span>
                    </div>
                    <div className="kw-dayRow__body">
                      <div className="kw-dayRow__top">
                        <StatusChip
                          tone={
                            day.status === 'PRESENT'
                              ? 'ok'
                              : day.status === 'LATE'
                                ? 'attention'
                                : day.status === 'MISSING_PUNCH'
                                  ? 'blocked'
                                  : 'neutral'
                          }
                          dot
                        >
                          {humanise(day.status)}
                        </StatusChip>
                        <span className="kw-dayRow__times">
                          {day.clockInAt ? dayjs(day.clockInAt).format('HH:mm') : '—'} →{' '}
                          {day.clockOutAt ? dayjs(day.clockOutAt).format('HH:mm') : '—'}
                        </span>
                        <span className="kw-dayRow__worked">{hhmm(day.workedMinutes)}</span>
                      </div>
                      {day.lateMinutes || day.overtimeMinutes > 0 || day.corrected ? (
                        <div className="kw-dayRow__notes">
                          {day.lateMinutes ? <span className="kw-warn">{day.lateMinutes}m late</span> : null}
                          {day.overtimeMinutes > 0 ? (
                            <span className={day.overtimeApproved ? 'kw-good' : 'kw-warn'}>
                              {hhmm(day.overtimeMinutes)} overtime {day.overtimeApproved ? 'approved' : 'pending'}
                            </span>
                          ) : null}
                          {day.corrected ? (
                            <span className="kw-muted" title={day.correctionReason ?? ''}>
                              corrected
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    {day.overtimeMinutes > 0 && !day.overtimeApproved ? (
                      <Button
                        size="small"
                        loading={approveOvertime.isPending}
                        onClick={() =>
                          approveOvertime.mutate(
                            { id: day.id },
                            {
                              onSuccess: () => message.success('Overtime approved'),
                              onError: (error: Error) => message.error(error.message),
                            },
                          )
                        }
                      >
                        Approve OT
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </DrawerSection>
        ) : null}
      </DetailDrawer>
    </AdminShell>
  );
}
