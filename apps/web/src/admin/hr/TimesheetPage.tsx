import { useMemo, useState } from 'react';
import { App } from 'antd';
import { Link, useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useRosterRange } from '../../appointment/hooks/useRoster';
import { useLeaveRequests } from '../../hr/hooks/useLeaveRequests';
import {
  useApproveOvertime,
  useAttendancePolicy,
  useClockStaff,
  useCorrectAttendance,
  useCorrectionRequests,
  useDecideCorrection,
  useEmployees,
  useTimesheet,
} from '../hooks/useAdmin';
import { clinicDayjs, clinicDayjsAtWall, formatClinicTime } from '../../clinical/clinicTime';
import { AuthImage, Drawer, HrPage, Panel, SegControl, StatCard, StatRow, StatusChip } from './ui';
import { Table } from './ui/Table';
import { IconClock, IconDownload, IconEdit } from './ui/icons';
import { initialsOf } from './ui/who';
import { downloadCsv } from './ui/csv';
import type { TimesheetReport } from '../types';

type Tab = 'timesheet' | 'roster' | 'corrections' | 'summary';
type StaffRow = TimesheetReport['staff'][number];
type Day = StaffRow['days'][number];

/** A row on the day sheet: what was rostered, what was punched, what was decided. */
interface DayRow {
  staffId: string;
  name: string;
  record: Day | null;
  shiftStart: string | null;
  shiftEnd: string | null;
  leaveType: string | null;
  /** Clocked in, no clock-out yet, and the shift has not ended. Not a missing punch. */
  onDuty: boolean;
}

const hours = (minutes: number | null | undefined) =>
  minutes === null || minutes === undefined ? '—' : (minutes / 60).toFixed(1);

/** The file id inside `/me/files/<id>`, read back by HR from its own route. */
function proofPath(path: string | null): string | null {
  const id = path?.startsWith('/me/files/') ? path.slice('/me/files/'.length) : null;
  return id ? `/workforce/staff-files/${id}` : null;
}

/**
 * ATTENDANCE, after `attendance.html` — one day at a time.
 *
 * THE DAY IS THE UNIT, because "who is late this morning" and "who never
 * clocked out yesterday" are the two questions this screen is opened for, and
 * a month-long list answers neither without arithmetic. The month is still
 * here, as the fourth tab, for the payroll conversation.
 *
 * THE SHEET IS EVERYBODY EXPECTED, not everybody who punched. A person who
 * was rostered and never clocked in has no attendance row at all, so a sheet
 * built from records alone is a sheet that cannot show the one thing it is
 * for. Rows come from three places — the punches, the roster and approved
 * leave — and each row says which.
 *
 * WHAT IS NEW IN 3g IS ON THE ROW: the selfie kept with each punch (fetched
 * with the manager's own token, never a bare URL), and a gold *Outside
 * clinic* chip with the distance when the phone was further from the branch
 * than the radius allows. Neither refuses a punch. The manager decides.
 *
 * THE ROSTER IS NOT REDRAWN HERE. There is one shift board in this product,
 * shared with the appointment calendar, and the Roster tab goes to it rather
 * than forking it.
 */
export function TimesheetPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const { clinicId, setClinicId, clinics, showSelector } = useClinicFilter();

  const [tab, setTab] = useState<Tab>('timesheet');
  const [day, setDay] = useState(clinicDayjs(new Date()).format('YYYY-MM-DD'));
  const [month, setMonth] = useState(clinicDayjs(new Date()).startOf('month'));
  const [fixing, setFixing] = useState<DayRow | null>(null);
  const [clockIn, setClockIn] = useState('');
  const [clockOut, setClockOut] = useState('');
  const [why, setWhy] = useState('');

  const today = useTimesheet({ from: day, to: day, clinicId });
  const monthSheet = useTimesheet({
    from: month.format('YYYY-MM-DD'),
    to: month.endOf('month').format('YYYY-MM-DD'),
    clinicId,
  });
  const corrections = useCorrectionRequests(clinicId);
  const decideCorrection = useDecideCorrection();
  const approveOvertime = useApproveOvertime();
  const correct = useCorrectAttendance();
  const clockStaff = useClockStaff();
  const policy = useAttendancePolicy(clinicId);
  // A roster belongs to one branch, so the "rostered but never clocked in"
  // rows only exist once a branch is chosen. The sheet says so rather than
  // quietly showing fewer people.
  const roster = useRosterRange(clinicId, day, day);
  const employees = useEmployees({});
  const leave = useLeaveRequests();

  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of employees.data ?? []) map.set(row.staffId, row.fullName);
    return map;
  }, [employees.data]);

  const rows = useMemo<DayRow[]>(() => {
    const byStaff = new Map<string, DayRow>();
    for (const person of today.data?.staff ?? []) {
      const record = person.days.find((row) => row.workDate === day) ?? null;
      byStaff.set(person.staffId, {
        staffId: person.staffId,
        name: person.name,
        record,
        shiftStart: record?.scheduledStart ?? null,
        shiftEnd: record?.scheduledEnd ?? null,
        leaveType: null,
        onDuty: false,
      });
    }
    for (const shift of roster.data ?? []) {
      const existing = byStaff.get(shift.staffId);
      if (existing) {
        existing.shiftStart = existing.shiftStart ?? shift.startsAt;
        existing.shiftEnd = existing.shiftEnd ?? shift.endsAt;
        continue;
      }
      byStaff.set(shift.staffId, {
        staffId: shift.staffId,
        name: nameOf.get(shift.staffId) ?? 'Not on the employee list',
        record: null,
        shiftStart: shift.startsAt,
        shiftEnd: shift.endsAt,
        leaveType: null,
        onDuty: false,
      });
    }
    for (const request of leave.data ?? []) {
      if (request.status !== 'APPROVED') continue;
      if (request.startDate.slice(0, 10) > day || request.endDate.slice(0, 10) < day) continue;
      const existing = byStaff.get(request.staffId);
      if (existing) {
        existing.leaveType = request.leaveType;
        continue;
      }
      byStaff.set(request.staffId, {
        staffId: request.staffId,
        name: request.staff?.fullName ?? nameOf.get(request.staffId) ?? '—',
        record: null,
        shiftStart: null,
        shiftEnd: null,
        leaveType: request.leaveType,
        onDuty: false,
      });
    }
    /*
     * ON DUTY IS NOT A MISSING PUNCH. Somebody who clocked in this morning and
     * is still on the floor has no clock-out, and counting them as a missing
     * punch turns every normal working day into an exception list. The shift's
     * end — or the end of the day when nothing was rostered — is the line.
     */
    const now = clinicDayjs(new Date());
    const stillToday = day === now.format('YYYY-MM-DD');
    for (const row of byStaff.values()) {
      if (!row.record?.clockInAt || row.record.clockOutAt) continue;
      const endsAt = row.shiftEnd ? clinicDayjs(row.shiftEnd) : null;
      row.onDuty = stillToday && (endsAt ? now.isBefore(endsAt) : true);
    }
    return [...byStaff.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [today.data, roster.data, leave.data, nameOf, day]);

  const onLeave = rows.filter((row) => row.leaveType !== null).length;
  const expected = rows.length - onLeave;
  const punched = rows.filter((row) => row.record?.clockInAt);
  // "On time" is about the arrival, so somebody still on the floor counts.
  const onTime = punched.filter((row) => (row.record?.lateMinutes ?? 0) === 0).length;
  const lateRows = punched.filter((row) => (row.record?.lateMinutes ?? 0) > 0);
  const lateMinutes = lateRows.reduce((total, row) => total + (row.record?.lateMinutes ?? 0), 0);
  const missing = punched.filter((row) => row.record && !row.record.clockOutAt && !row.onDuty);
  const otMinutes = punched.reduce((total, row) => total + (row.record?.overtimeMinutes ?? 0), 0);
  const otPending = punched.filter((row) => (row.record?.overtimeMinutes ?? 0) > 0 && !row.record?.overtimeApproved).length;
  // Approved and unapproved overtime are never one figure: what is unapproved
  // is what payroll will NOT pay, and that is the number a manager acts on.
  const otPendingMinutes = punched
    .filter((row) => !row.record?.overtimeApproved)
    .reduce((total, row) => total + (row.record?.overtimeMinutes ?? 0), 0);
  const monthOtMinutes = (monthSheet.data?.staff ?? []).reduce(
    (total, person) => total + person.approvedOvertimeMinutes + person.unapprovedOvertimeMinutes,
    0,
  );

  const rules = policy.data?.policy;
  const waiting = corrections.data?.length ?? 0;

  const openFix = (row: DayRow) => {
    setFixing(row);
    setClockIn(row.record?.clockInAt ? formatClinicTime(row.record.clockInAt) : '');
    setClockOut(row.record?.clockOutAt ? formatClinicTime(row.record.clockOutAt) : '');
    setWhy('');
  };

  const at = (hhmm: string) => (hhmm ? clinicDayjsAtWall(`${day} ${hhmm}`).toISOString() : undefined);

  const saveFix = async () => {
    if (!fixing) return;
    if (why.trim().length < 5) {
      message.error('Say why the record is being changed. The employee sees it too.');
      return;
    }
    try {
      if (fixing.record) {
        await correct.mutateAsync({
          id: fixing.record.id,
          clockInAt: at(clockIn),
          clockOutAt: at(clockOut),
          reason: why.trim(),
        });
        message.success('Corrected. The original punch stays on the record.');
      } else {
        if (!clockIn) {
          message.error('A clock-in time is needed.');
          return;
        }
        await clockStaff.mutateAsync({ staffId: fixing.staffId, clinicId, at: at(clockIn) });
        message.success(`Clocked ${fixing.name} in. The punch is marked as entered by HR.`);
      }
      setFixing(null);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Could not save that.');
    }
  };

  const exportDay = () =>
    downloadCsv(
      `attendance-${day}`,
      ['Employee', 'Shift', 'Clock in', 'Clock out', 'Result', 'Hours', 'OT hours', 'OT status', 'Recorded by'],
      rows.map((row) => [
        row.name,
        row.shiftStart ? `${formatClinicTime(row.shiftStart)}–${formatClinicTime(row.shiftEnd)}` : '',
        row.record?.clockInAt ? formatClinicTime(row.record.clockInAt) : '',
        row.record?.clockOutAt ? formatClinicTime(row.record.clockOutAt) : '',
        resultText(row),
        row.record ? hours(row.record.workedMinutes) : '',
        row.record ? hours(row.record.overtimeMinutes) : '',
        row.record?.overtimeMinutes ? (row.record.overtimeApproved ? 'Approved' : 'Pending') : '',
        row.record ? (row.record.source === 'MANUAL' ? 'HR' : 'The employee') : '',
      ]),
    );

  return (
    <HrPage
      title="Attendance"
      sub="Clock-ins against the roster. Late and early-leave minutes, overtime and total hours are worked out for you."
      error={today.isError ? 'The timesheet could not be loaded.' : null}
      actions={
        <>
          {showSelector ? (
            <SegControl<string>
              label="Branch"
              value={clinicId ?? ''}
              onChange={(value) => setClinicId(value === '' ? undefined : value)}
              options={[
                { value: '', label: 'All branches' },
                ...(clinics ?? []).map((clinic) => ({ value: clinic.id, label: clinic.name })),
              ]}
            />
          ) : null}
          <button type="button" className="hr-btn" onClick={exportDay}>
            <IconDownload />
            Export
          </button>
        </>
      }
    >
      <StatRow>
        <StatCard
          label="On time today"
          value={`${onTime} of ${expected}`}
          sub={onLeave > 0 ? `${onLeave} on leave` : 'Nobody on leave'}
        />
        <StatCard
          label="Late / left early"
          value={lateRows.length}
          tone={lateRows.length > 0 ? 'gold' : 'plain'}
          sub={lateMinutes > 0 ? `${lateMinutes} minutes in total` : 'Nothing to look at'}
        />
        <StatCard
          label="Missing clock-out"
          value={missing.length}
          tone={missing.length > 0 ? 'red' : 'plain'}
          sub={missing.length > 0 ? missing.map((row) => row.name).join(', ') : 'Every punch is a pair'}
        />
        <StatCard
          label="OT today"
          value={`${hours(otMinutes)} h`}
          tone={otPending > 0 ? 'gold' : 'plain'}
          sub={`${otPendingMinutes > 0 ? `${hours(otPendingMinutes)} h` : 'none'} pending approval · ${hours(monthOtMinutes)} h this month`}
        />
      </StatRow>

      <Panel className="hr-mt">
        <div className="hr-tabs" role="tablist" aria-label="Attendance views">
          <button type="button" role="tab" aria-selected={tab === 'timesheet'} className={tab === 'timesheet' ? 'is-active' : undefined} onClick={() => setTab('timesheet')}>
            Timesheet
          </button>
          <button type="button" role="tab" aria-selected={false} onClick={() => navigate('/admin/hr/attendance/roster')}>
            Roster
          </button>
          <button type="button" role="tab" aria-selected={tab === 'corrections'} className={tab === 'corrections' ? 'is-active' : undefined} onClick={() => setTab('corrections')}>
            Corrections
            {waiting > 0 ? <span className="hr-tabs__n">{waiting}</span> : null}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'summary'} className={tab === 'summary' ? 'is-active' : undefined} onClick={() => setTab('summary')}>
            Monthly summary
          </button>
        </div>

        {tab === 'timesheet' ? (
          <>
            <Table<DayRow>
              rows={rows}
              loading={today.isLoading}
              rowKey="staffId"
              searchFields={['name']}
              searchPlaceholder="Search employee"
              searchLabel="Search employee"
              emptyText="Nothing recorded for this day"
              emptyHint={
                clinicId
                  ? 'Nobody is rostered and nobody has clocked in.'
                  : 'Choose a branch to see who was rostered as well as who punched.'
              }
              toolbar={
                <div className="hr-seg" role="group" aria-label="Day">
                  <button type="button" aria-label="Previous day" onClick={() => setDay(dayjs(day).subtract(1, 'day').format('YYYY-MM-DD'))}>
                    ‹
                  </button>
                  <button type="button" className="is-active" onClick={() => setDay(clinicDayjs(new Date()).format('YYYY-MM-DD'))}>
                    {dayjs(day).format('ddd D MMM YYYY')}
                  </button>
                  <button type="button" aria-label="Next day" onClick={() => setDay(dayjs(day).add(1, 'day').format('YYYY-MM-DD'))}>
                    ›
                  </button>
                </div>
              }
              toolbarRight={
                <span className="hr-legend">
                  <span className="hr-tg">● On time</span>
                  <span className="hr-ts">● Late / early</span>
                  <span className="hr-teal">● Overtime</span>
                </span>
              }
              columns={[
                {
                  title: 'Employee',
                  dataIndex: 'name',
                  render: (value: string, row) => (
                    <div className="hr-who">
                      <span className="hr-who__avatar">{initialsOf(value)}</span>
                      <div>
                        <div className="hr-who__name">{value}</div>
                        {row.record?.source === 'MANUAL' ? <div className="hr-who__role">Entered by HR</div> : null}
                      </div>
                    </div>
                  ),
                },
                {
                  title: 'Shift',
                  key: 'shift',
                  width: 130,
                  render: (_: unknown, row) =>
                    row.shiftStart ? (
                      <span className="hr-tn">
                        {formatClinicTime(row.shiftStart)}–{formatClinicTime(row.shiftEnd)}
                      </span>
                    ) : (
                      <span className="hr-tn">No shift</span>
                    ),
                },
                {
                  title: 'Clock in',
                  key: 'in',
                  width: 130,
                  render: (_: unknown, row) => <Punch at={row.record?.clockInAt ?? null} proof={row.record?.proofUrl ?? null} late={(row.record?.lateMinutes ?? 0) > 0} alt="Clock-in selfie" />,
                },
                {
                  title: 'Clock out',
                  key: 'out',
                  width: 130,
                  render: (_: unknown, row) => (
                    <Punch
                      at={row.record?.clockOutAt ?? null}
                      proof={row.record?.clockOutProofUrl ?? null}
                      late={(row.record?.earlyOutMinutes ?? 0) > 0}
                      alt="Clock-out selfie"
                    />
                  ),
                },
                {
                  title: 'Result',
                  key: 'result',
                  width: 230,
                  render: (_: unknown, row) => <Result row={row} />,
                },
                { title: 'Hours', key: 'hours', num: true, width: 80, render: (_: unknown, row) => (row.record ? hours(row.record.workedMinutes) : '—') },
                {
                  title: 'OT h',
                  key: 'ot',
                  num: true,
                  width: 80,
                  render: (_: unknown, row) =>
                    row.record && row.record.overtimeMinutes > 0 ? (
                      <span className="hr-teal">{hours(row.record.overtimeMinutes)}</span>
                    ) : (
                      <span className="hr-tn">0.0</span>
                    ),
                },
                {
                  title: 'OT status',
                  key: 'otStatus',
                  width: 150,
                  render: (_: unknown, row) => {
                    if (!row.record || row.record.overtimeMinutes === 0) return null;
                    if (row.record.overtimeApproved) return <StatusChip tone="done">Approved</StatusChip>;
                    const id = row.record.id;
                    return (
                      <button
                        type="button"
                        className="hr-btn hr-btn--sm"
                        disabled={approveOvertime.isPending}
                        onClick={() =>
                          approveOvertime.mutate(
                            { id },
                            {
                              onSuccess: () => message.success('Overtime approved. It reaches the payroll month.'),
                              onError: (error: Error) => message.error(error.message),
                            },
                          )
                        }
                      >
                        Pending · approve
                      </button>
                    );
                  },
                },
                {
                  title: '',
                  key: 'fix',
                  width: 80,
                  render: (_: unknown, row) =>
                    row.leaveType && !row.record ? null : (
                      <button type="button" className="hr-btn hr-btn--sm" onClick={() => openFix(row)}>
                        <IconEdit />
                        Fix
                      </button>
                    ),
                },
              ]}
            />
            <div className="hr-tableFoot">
              <span>
                <b>Rules in force:</b>{' '}
                {rules
                  ? `${rules.lateGraceMinutes}-min grace · OT counts after ${rules.overtimeMinimumMinutes} min past shift, ${rules.overtimeRoundingMinutes > 0 ? `rounded down to ${rules.overtimeRoundingMinutes} min` : 'not rounded'} · ${rules.overtimeRequiresApproval ? 'needs approval before payroll' : 'reaches payroll without approval'}`
                  : 'loading'}
                {rules?.geofenceLat !== null && rules?.geofenceLat !== undefined
                  ? ` · portal punches judged within ${rules.geofenceRadiusMetres} m of the branch`
                  : ''}
              </span>
              <span className="hr-tn">Overtime nobody has approved is not paid.</span>
              <Link className="hr-link" to="/admin/hr/settings/attendance-leave">
                Change in Settings
              </Link>
            </div>
          </>
        ) : null}

        {tab === 'corrections' ? (
          <Table
            rows={corrections.data}
            loading={corrections.isLoading}
            rowKey="id"
            emptyText="Nothing waiting"
            emptyHint="Employees ask for a fix from their portal. Nothing changes until you decide, and the original stays on the record."
            columns={[
              {
                title: 'Who',
                dataIndex: 'staffName',
                render: (value: string, row) => (
                  <div className="hr-who">
                    <span className="hr-who__avatar">{initialsOf(value)}</span>
                    <div>
                      <div className="hr-who__name">{value}</div>
                      <div className="hr-who__role">{dayjs(row.record.workDate).format('ddd D MMM YYYY')}</div>
                    </div>
                  </div>
                ),
              },
              {
                title: 'Recorded',
                key: 'recorded',
                width: 150,
                render: (_: unknown, row) =>
                  `${row.record.clockInAt ? formatClinicTime(row.record.clockInAt) : '—'} – ${row.record.clockOutAt ? formatClinicTime(row.record.clockOutAt) : '—'}`,
              },
              {
                title: 'Asked for',
                key: 'asked',
                width: 150,
                render: (_: unknown, row) =>
                  `${row.requestedClockInAt ? formatClinicTime(row.requestedClockInAt) : 'unchanged'} – ${row.requestedClockOutAt ? formatClinicTime(row.requestedClockOutAt) : 'unchanged'}`,
              },
              { title: 'Why', dataIndex: 'reason' },
              {
                title: '',
                key: 'decide',
                width: 180,
                render: (_: unknown, row) => (
                  <span className="hr-dots">
                    <button
                      type="button"
                      className="hr-btn hr-btn--sm hr-btn--primary"
                      disabled={decideCorrection.isPending}
                      onClick={async () => {
                        try {
                          await decideCorrection.mutateAsync({ id: row.id, approve: true });
                          message.success(`${row.staffName}'s ${dayjs(row.record.workDate).format('D MMM')} corrected.`);
                        } catch (error) {
                          message.error(error instanceof Error ? error.message : 'Could not apply that.');
                        }
                      }}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="hr-btn hr-btn--sm"
                      disabled={decideCorrection.isPending}
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
                    </button>
                  </span>
                ),
              },
            ]}
          />
        ) : null}

        {tab === 'summary' ? (
          <Table<StaffRow>
            rows={monthSheet.data?.staff}
            loading={monthSheet.isLoading}
            rowKey="staffId"
            searchFields={['name']}
            searchPlaceholder="Search employee"
            searchLabel="Search employee"
            emptyText="No attendance recorded this month"
            toolbar={
              <div className="hr-seg" role="group" aria-label="Month">
                <button type="button" aria-label="Previous month" onClick={() => setMonth(month.subtract(1, 'month'))}>
                  ‹
                </button>
                <button type="button" className="is-active" onClick={() => setMonth(clinicDayjs(new Date()).startOf('month'))}>
                  {month.format('MMMM YYYY')}
                </button>
                <button type="button" aria-label="Next month" onClick={() => setMonth(month.add(1, 'month'))}>
                  ›
                </button>
              </div>
            }
            toolbarRight={
              <button
                type="button"
                className="hr-btn hr-btn--sm"
                onClick={() =>
                  downloadCsv(
                    `attendance-${month.format('YYYY-MM')}`,
                    ['Employee', 'Present', 'Absent', 'On leave', 'Missing punch', 'Worked hours', 'Late occasions', 'Late minutes', 'OT approved (h)', 'OT pending (h)'],
                    (monthSheet.data?.staff ?? []).map((person) => [
                      person.name,
                      person.daysPresent,
                      person.daysAbsent,
                      person.daysOnLeave,
                      person.daysMissingPunch,
                      person.workedHours,
                      person.lateOccasions,
                      person.lateMinutes,
                      person.approvedOvertimeHours,
                      person.unapprovedOvertimeHours,
                    ]),
                  )
                }
              >
                <IconDownload />
                Export
              </button>
            }
            columns={[
              {
                title: 'Employee',
                dataIndex: 'name',
                render: (value: string, row) => (
                  <div className="hr-who">
                    <span className="hr-who__avatar">{initialsOf(value)}</span>
                    <div>
                      <div className="hr-who__name">{value}</div>
                      <div className="hr-who__role">
                        {row.days.length} day{row.days.length === 1 ? '' : 's'} recorded
                      </div>
                    </div>
                  </div>
                ),
              },
              { title: 'Present', dataIndex: 'daysPresent', num: true, width: 90 },
              { title: 'Absent', dataIndex: 'daysAbsent', num: true, width: 85 },
              { title: 'On leave', dataIndex: 'daysOnLeave', num: true, width: 95 },
              {
                title: 'Missing punch',
                dataIndex: 'daysMissingPunch',
                num: true,
                width: 125,
                render: (count: number) => (count > 0 ? <span className="hr-ts">{count}</span> : <span className="hr-tn">0</span>),
              },
              { title: 'Worked', dataIndex: 'workedHours', num: true, width: 95, render: (value: number) => `${value.toFixed(1)} h` },
              {
                title: 'Late',
                dataIndex: 'lateOccasions',
                num: true,
                width: 120,
                render: (count: number, row) =>
                  count === 0 ? <span className="hr-tn">0</span> : <span className="hr-ts">{count}× · {row.lateMinutes} min</span>,
              },
              {
                title: 'OT approved',
                dataIndex: 'approvedOvertimeHours',
                num: true,
                width: 120,
                render: (value: number) => (value === 0 ? <span className="hr-tn">—</span> : <span className="hr-tg">{value.toFixed(1)} h</span>),
              },
              {
                title: 'OT pending',
                dataIndex: 'unapprovedOvertimeHours',
                num: true,
                width: 115,
                render: (value: number) => (value === 0 ? <span className="hr-tn">—</span> : <span className="hr-gold">{value.toFixed(1)} h</span>),
              },
            ]}
          />
        ) : null}
      </Panel>

      <Drawer
        open={fixing !== null}
        title={fixing?.record ? `Fix ${fixing.name}'s day` : `Record a punch for ${fixing?.name ?? ''}`}
        sub={dayjs(day).format('dddd D MMMM YYYY')}
        onClose={() => setFixing(null)}
        footer={
          <>
            <button type="button" className="hr-btn" onClick={() => setFixing(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="hr-btn hr-btn--primary"
              onClick={saveFix}
              disabled={correct.isPending || clockStaff.isPending}
            >
              {fixing?.record ? 'Save the correction' : 'Record the clock-in'}
            </button>
          </>
        }
      >
        <div className="hr-pform">
          <div>
            <label htmlFor="fix-in">Clock in</label>
            <input id="fix-in" type="time" className="hr-f" value={clockIn} onChange={(event) => setClockIn(event.target.value)} />
          </div>
          <div>
            <label htmlFor="fix-out">Clock out</label>
            <input
              id="fix-out"
              type="time"
              className="hr-f"
              value={clockOut}
              disabled={!fixing?.record}
              onChange={(event) => setClockOut(event.target.value)}
            />
          </div>
          {fixing?.record ? (
            <div className="hr-pform__full">
              <label htmlFor="fix-why">Why</label>
              <textarea
                id="fix-why"
                className="hr-f"
                placeholder="e.g. Clocked in at reception, phone was flat"
                value={why}
                onChange={(event) => setWhy(event.target.value)}
              />
            </div>
          ) : null}
        </div>
        {fixing?.record ? (
          <div className="hr-notice hr-notice--info">
            The original punch stays on the record with your name and the reason against it. The employee sees both.
          </div>
        ) : (
          <div className="hr-notice hr-notice--attn">
            <IconClock /> There is no punch for this day. Recording one here marks it as <b>entered by HR</b>, never as
            the employee's own.
          </div>
        )}
        {fixing?.record?.outsideClinic ? (
          <div className="hr-notice hr-notice--attn">
            This punch was {fixing.record.distanceMetres !== null ? `${fixing.record.distanceMetres} m` : 'further than the radius'} from the
            branch.
          </div>
        ) : null}
      </Drawer>
    </HrPage>
  );
}

/** A punch: the selfie kept with it, then the time. */
function Punch({ at, proof, late, alt }: { at: string | null; proof: string | null; late: boolean; alt: string }) {
  const path = proofPath(proof);
  if (!at) return <span className="hr-tn">—</span>;
  return (
    <span className="hr-dots">
      {path ? <AuthImage path={path} alt={alt} className="hr-proof" /> : null}
      <span className={late ? 'hr-ts' : 'hr-tg'}>{formatClinicTime(at)}</span>
    </span>
  );
}

/** What the day amounted to, in the same words the employee's portal uses. */
function resultText(row: DayRow): string {
  if (row.record) {
    const record = row.record;
    if (row.onDuty) return record.lateMinutes ? `On duty · late ${record.lateMinutes} min` : 'On duty';
    if (record.status === 'MISSING_PUNCH' || !record.clockOutAt)
      return `${record.lateMinutes ? `Late ${record.lateMinutes} min · ` : ''}no clock-out`;
    if (record.status === 'ON_LEAVE') return 'Leave';
    if (record.status === 'ABSENT') return 'Absent';
    if ((record.lateMinutes ?? 0) > 0) return `Late ${record.lateMinutes} min`;
    if ((record.earlyOutMinutes ?? 0) > 0) return `Left ${record.earlyOutMinutes} min early`;
    return 'On time';
  }
  if (row.leaveType) return `${row.leaveType.toLowerCase()} leave`;
  if (row.shiftStart) return 'Rostered, no clock-in';
  return '—';
}

function Result({ row }: { row: DayRow }) {
  const text = resultText(row);
  const record = row.record;
  const bad = record
    ? (!row.onDuty && (record.status === 'MISSING_PUNCH' || !record.clockOutAt)) ||
      (record.lateMinutes ?? 0) > 0 ||
      (record.earlyOutMinutes ?? 0) > 0
    : Boolean(row.shiftStart);
  return (
    <span className="hr-dots">
      {row.leaveType && !record ? (
        <StatusChip tone="attn">{text}</StatusChip>
      ) : (
        <span className={bad ? 'hr-ts' : 'hr-tg'}>{text}</span>
      )}
      {record?.outsideClinic ? (
        <StatusChip tone="attn">
          Outside clinic{record.distanceMetres !== null ? ` · ${record.distanceMetres >= 1000 ? `${(record.distanceMetres / 1000).toFixed(1)} km` : `${record.distanceMetres} m`}` : ''}
        </StatusChip>
      ) : null}
      {record?.corrected ? <StatusChip tone="info">Corrected</StatusChip> : null}
    </span>
  );
}
