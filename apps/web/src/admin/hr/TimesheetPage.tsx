import { useEffect, useMemo, useState } from 'react';
import { App } from 'antd';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
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
import { AuthImage, Drawer, duration, HrPage, Panel, SegControl, StatCard, StatRow, StatusChip } from './ui';
import { Table } from './ui/Table';
import { IconClock, IconDownload, IconEdit } from './ui/icons';
import { initialsOf } from './ui/who';
import { downloadCsv } from './ui/csv';
import type { AttendancePunchRow, TimesheetReport } from '../types';

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

/**
 * The export is read by a spreadsheet, not by a person, so it carries a bare
 * number that never changes unit and keeps the precision the screen rounds
 * away. `duration` is for the screen; this is for the file.
 */
const csvHours = (minutes: number | null | undefined) =>
  minutes === null || minutes === undefined ? '' : (minutes / 60).toFixed(2);

/**
 * STILL ON THE FLOOR, rather than a missing punch: clocked in, not out, and
 * the shift has not ended — today. Both the day sheet and a person's month
 * ask this, and a rule written twice is a rule that drifts, so it is written
 * here.
 */
function onDutyNow(record: { clockInAt: string | null; clockOutAt: string | null }, workDate: string, shiftEnd: string | null): boolean {
  if (!record.clockInAt || record.clockOutAt) return false;
  const now = clinicDayjs(new Date());
  if (workDate.slice(0, 10) !== now.format('YYYY-MM-DD')) return false;
  return shiftEnd ? now.isBefore(clinicDayjs(shiftEnd)) : true;
}

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

  /*
   * THE MONTHLY SUMMARY'S FIGURES ARE LINKS, AND A LINK HAS TO ARRIVE
   * SOMEWHERE.
   *
   * Piece 1 made every figure on the summary a link to
   * `/admin/hr/attendance?staffId=…&month=…` (finding 12) and stopped there.
   * That route is THIS page: React Router changed the URL, the component
   * stayed mounted with its own tab and month in local state, and the screen
   * did not move. Pressing 88.0 h did nothing at all — a link that goes
   * nowhere is worse than the dead end it replaced, because it looks like it
   * works.
   *
   * So the page reads the focus off the URL. With a staffId in it the summary
   * shows ONE person's month, day by day, which is what the figure is made
   * of.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const focusStaffId = searchParams.get('staffId');
  const focusMonth = searchParams.get('month');

  const [tab, setTab] = useState<Tab>('timesheet');
  const [day, setDay] = useState(clinicDayjs(new Date()).format('YYYY-MM-DD'));
  const [month, setMonth] = useState(clinicDayjs(new Date()).startOf('month'));
  const [fixing, setFixing] = useState<DayRow | null>(null);
  const [punchDraft, setPunchDraft] = useState<PunchDraft[]>([]);
  const [clockIn, setClockIn] = useState('');
  const [clockOut, setClockOut] = useState('');
  const [why, setWhy] = useState('');

  // Arriving with a person in the URL means the month, on that person.
  useEffect(() => {
    if (focusStaffId) setTab('summary');
  }, [focusStaffId]);
  useEffect(() => {
    if (focusMonth) setMonth(clinicDayjs(`${focusMonth}-01`).startOf('month'));
  }, [focusMonth]);

  const today = useTimesheet({ from: day, to: day, clinicId });
  const monthSheet = useTimesheet({
    from: month.format('YYYY-MM-DD'),
    to: month.endOf('month').format('YYYY-MM-DD'),
    clinicId,
  });
  const focused = useMemo(
    () => (focusStaffId ? ((monthSheet.data?.staff ?? []).find((person) => person.staffId === focusStaffId) ?? null) : null),
    [focusStaffId, monthSheet.data],
  );
  const clearFocus = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('staffId');
    next.delete('month');
    setSearchParams(next, { replace: true });
  };
  /*
   * A TAB IS TOP-LEVEL NAVIGATION, so pressing one leaves the person behind.
   * Without this, pressing Monthly summary while focused on Dr Meera Kaur
   * returns to Dr Meera Kaur, and the tab appears not to work — the same
   * complaint this piece exists to answer, one screen along.
   */
  const goTab = (next: Tab) => {
    clearFocus();
    setTab(next);
  };

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
  // THE BRANCH'S PEOPLE AND THE BRANCH'S LEAVE. Both were fetched for the
  // whole tenant, so with an empty branch selected the sheet still listed a
  // doctor from another branch and counted her as "1 on leave".
  const employees = useEmployees({ clinicId });
  const leave = useLeaveRequests({ clinicId });

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
    for (const row of byStaff.values()) {
      if (!row.record) continue;
      row.onDuty = onDutyNow(row.record, day, row.shiftEnd);
    }
    return [...byStaff.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [today.data, roster.data, leave.data, nameOf, day]);

  // EXCEPTIONS ONLY (UAT, 14 October 2026): "HR sees exceptions only: late,
  // left early, missed scan, scan without shift", and every PIN or
  // away-from-clinic clock-in.
  const [exceptionsOnly, setExceptionsOnly] = useState(false);
  const exceptionsOf = (row: DayRow): string[] => {
    const record = row.record;
    const reasons: string[] = [];
    if (row.leaveType) return reasons;
    if (!record && row.shiftStart && new Date(row.shiftStart) < new Date()) reasons.push('Missed scan');
    if (!record) return reasons;
    if ((record.lateMinutes ?? 0) > 0) reasons.push('Late');
    if ((record.earlyOutMinutes ?? 0) > 0) reasons.push('Left early');
    if (!row.onDuty && record.clockInAt && !record.clockOutAt) reasons.push('Missed scan');
    if (!row.shiftStart && record.clockInAt) reasons.push('Scan without shift');
    if (record.source === 'PIN') reasons.push('PIN at kiosk');
    if (record.outsideClinic) reasons.push('Away from clinic');
    return reasons;
  };
  const shown = exceptionsOnly ? rows.filter((row) => exceptionsOf(row).length > 0) : rows;

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
    // The drawer opens on the day as it stands: every punch that counts, in
    // order. A superseded one is already history and is not editable again.
    setPunchDraft(
      (row.record?.punches ?? [])
        .filter((punch) => !punch.supersededAt)
        .map((punch) => ({ id: punch.id, at: formatClinicTime(punch.at), kind: punch.kind })),
    );
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
        // The whole day goes back, punch by punch: what moved, what was marked
        // wrong, and what was added. A punch with no time was added and never
        // filled in, and is simply not sent.
        await correct.mutateAsync({
          id: fixing.record.id,
          punches: punchDraft
            .filter((punch) => punch.wrong || punch.at)
            .map((punch) => ({
              ...(punch.id ? { id: punch.id } : {}),
              ...(punch.wrong ? { wrong: true } : { at: at(punch.at), kind: punch.kind }),
            })),
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
        csvHours(row.record?.workedMinutes),
        csvHours(row.record?.overtimeMinutes),
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
          value={duration(otMinutes)}
          tone={otPending > 0 ? 'gold' : 'plain'}
          sub={`${otPendingMinutes > 0 ? duration(otPendingMinutes) : 'none'} pending approval · ${duration(monthOtMinutes)} this month`}
        />
      </StatRow>

      <Panel className="hr-mt">
        <div className="hr-tabs" role="tablist" aria-label="Attendance views">
          <button type="button" role="tab" aria-selected={tab === 'timesheet'} className={tab === 'timesheet' ? 'is-active' : undefined} onClick={() => goTab('timesheet')}>
            Timesheet
          </button>
          <button type="button" role="tab" aria-selected={false} onClick={() => navigate('/admin/hr/attendance/roster')}>
            Roster
          </button>
          <button type="button" role="tab" aria-selected={tab === 'corrections'} className={tab === 'corrections' ? 'is-active' : undefined} onClick={() => goTab('corrections')}>
            Corrections
            {waiting > 0 ? <span className="hr-tabs__n">{waiting}</span> : null}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'summary'} className={tab === 'summary' ? 'is-active' : undefined} onClick={() => goTab('summary')}>
            Monthly summary
          </button>
        </div>

        {tab === 'timesheet' ? (
          <>
            <Table<DayRow>
              rows={shown}
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
              toolbarLead={
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
              toolbar={
                <button
                  type="button"
                  className={exceptionsOnly ? 'hr-btn hr-btn--sm hr-btn--primary' : 'hr-btn hr-btn--sm'}
                  aria-pressed={exceptionsOnly}
                  onClick={() => setExceptionsOnly((value) => !value)}
                >
                  Exceptions only
                </button>
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
                        {exceptionsOf(row).length > 0 ? <div className="hr-who__role">{exceptionsOf(row).join(' · ')}</div> : null}
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
                  title: 'Punches',
                  key: 'punches',
                  width: 230,
                  render: (_: unknown, row) =>
                    row.record ? (
                      <Punches punches={row.record.punches ?? []} alt={`${row.name}, punch selfie`} />
                    ) : (
                      <span className="hr-tn">—</span>
                    ),
                },
                {
                  title: 'Result',
                  key: 'result',
                  width: 230,
                  render: (_: unknown, row) => <Result row={row} />,
                },
                { title: 'Worked', key: 'hours', num: true, width: 85, render: (_: unknown, row) => (row.record ? duration(row.record.workedMinutes) : '—') },
                {
                  title: 'Overtime',
                  key: 'ot',
                  num: true,
                  width: 90,
                  render: (_: unknown, row) =>
                    row.record && row.record.overtimeMinutes > 0 ? (
                      <span className="hr-teal">{duration(row.record.overtimeMinutes)}</span>
                    ) : (
                      <span className="hr-tn">0.0 h</span>
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
                  ? `${rules.lateGraceMinutes}-min grace · OT counts after ${rules.overtimeMinimumMinutes} min past shift, ${rules.overtimeRoundingMinutes > 0 ? `rounded down to ${rules.overtimeRoundingMinutes} min` : 'not rounded'} · needs approval before payroll`
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

        {tab === 'summary' && focusStaffId ? (
          <Table<Day>
            rows={focused ? [...focused.days].sort((a, b) => a.workDate.localeCompare(b.workDate)) : []}
            loading={monthSheet.isLoading}
            rowKey="id"
            emptyText={`Nothing recorded for this employee in ${month.format('MMMM YYYY')}`}
            toolbarLead={
              <div className="hr-focus">
                <button type="button" className="hr-link" onClick={clearFocus}>
                  Back to everybody
                </button>
                <span className="hr-focus__who">
                  {focused?.name ?? nameOf.get(focusStaffId) ?? 'This employee'} · {month.format('MMMM YYYY')}
                </span>
              </div>
            }
            columns={[
              {
                title: 'Day',
                dataIndex: 'workDate',
                width: 150,
                render: (value: string) => (
                  <button
                    type="button"
                    className="hr-link"
                    onClick={() => {
                      setDay(value.slice(0, 10));
                      goTab('timesheet');
                    }}
                  >
                    {clinicDayjs(value).format('ddd D MMM')}
                  </button>
                ),
              },
              {
                title: 'Punches',
                key: 'punches',
                render: (_: unknown, row) => (
                  <Punches punches={row.punches ?? []} alt={`${focused?.name ?? 'Employee'}, punch selfie`} />
                ),
              },
              {
                title: 'Result',
                key: 'result',
                width: 190,
                render: (_: unknown, row) => (
                  <Result
                    row={{
                      staffId: focusStaffId,
                      name: focused?.name ?? '',
                      record: row,
                      shiftStart: row.scheduledStart,
                      shiftEnd: row.scheduledEnd,
                      leaveType: null,
                      onDuty: onDutyNow(row, row.workDate, row.scheduledEnd),
                    }}
                  />
                ),
              },
              { title: 'Worked', dataIndex: 'workedMinutes', num: true, width: 85, render: (value: number | null) => duration(value) },
              {
                title: 'Overtime',
                dataIndex: 'overtimeMinutes',
                num: true,
                width: 90,
                render: (value: number) => (value > 0 ? <span className="hr-teal">{duration(value)}</span> : <span className="hr-tn">0.0 h</span>),
              },
              {
                title: 'OT status',
                key: 'otStatus',
                width: 150,
                render: (_: unknown, row) => {
                  if (row.overtimeMinutes === 0) return null;
                  if (row.overtimeApproved) return <StatusChip tone="done">Approved</StatusChip>;
                  const id = row.id;
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
            ]}
          />
        ) : null}

        {tab === 'summary' && !focusStaffId ? (
          <Table<StaffRow>
            rows={monthSheet.data?.staff}
            loading={monthSheet.isLoading}
            rowKey="staffId"
            searchFields={['name']}
            searchPlaceholder="Search employee"
            searchLabel="Search employee"
            emptyText="No attendance recorded this month"
            toolbarLead={
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
              {
                title: 'Worked',
                dataIndex: 'workedHours',
                num: true,
                width: 95,
                render: (_: number, row) => (
                  <Link className="hr-link" to={`/admin/hr/attendance?staffId=${row.staffId}&month=${month.format('YYYY-MM')}`}>
                    {duration(row.workedMinutes)}
                  </Link>
                ),
              },
              {
                title: 'Late',
                dataIndex: 'lateOccasions',
                num: true,
                width: 120,
                render: (count: number, row) =>
                  count === 0 ? <span className="hr-tn">0</span> : <span className="hr-ts">{count}× · {row.lateMinutes} min</span>,
              },
              /*
                * A FIGURE THAT CANNOT BE OPENED IS A DEAD END (finding 12).
                *
                * "OT pending 4.0 h" with no way through to the days behind it
                * left the only route as walking the Timesheet backwards a day
                * at a time. Every number here now opens the month for that one
                * person, where the days it is made of are listed and each can
                * be approved.
                */
              {
                title: 'OT approved',
                dataIndex: 'approvedOvertimeHours',
                num: true,
                width: 120,
                render: (value: number, row) =>
                  value === 0 ? (
                    <span className="hr-tn">—</span>
                  ) : (
                    <Link className="hr-link hr-tg" to={`/admin/hr/attendance?staffId=${row.staffId}&month=${month.format('YYYY-MM')}`}>
                      {duration(row.approvedOvertimeMinutes)}
                    </Link>
                  ),
              },
              {
                title: 'OT pending',
                dataIndex: 'unapprovedOvertimeHours',
                num: true,
                width: 115,
                render: (value: number, row) =>
                  value === 0 ? (
                    <span className="hr-tn">—</span>
                  ) : (
                    <Link className="hr-link hr-gold" to={`/admin/hr/attendance?staffId=${row.staffId}&month=${month.format('YYYY-MM')}`}>
                      {duration(row.unapprovedOvertimeMinutes)}
                    </Link>
                  ),
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
        {fixing?.record ? (
          <PunchEditor
            punches={fixing.record.punches ?? []}
            draft={punchDraft}
            onChange={setPunchDraft}
          />
        ) : (
          <div className="hr-pform">
            <div>
              <label htmlFor="fix-in">Clock in</label>
              <input id="fix-in" type="time" className="hr-f" value={clockIn} onChange={(event) => setClockIn(event.target.value)} />
            </div>
          </div>
        )}
        {fixing?.record ? (
          <div className="hr-pform">
            <div className="hr-pform__full">
              <label htmlFor="fix-why">Why</label>
              <textarea
                id="fix-why"
                className="hr-f"
                placeholder="e.g. Clocked out at reception, phone was flat"
                value={why}
                onChange={(event) => setWhy(event.target.value)}
              />
            </div>
          </div>
        ) : null}
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


/** One line of the day as the manager left it. */
type PunchDraft = { id?: string; at: string; kind: 'IN' | 'OUT'; wrong?: boolean };

/**
 * THE FIX DRAWER IS THE DAY, NOT A FORM.
 *
 * Two time fields could not express a day somebody clocked out at lunch and
 * back in, which is the day this clinic's admin staff work. So the drawer
 * lists the punches in order and lets each one be moved, marked wrong, or
 * added to.
 *
 * "WRONG", IN WORDS, NEVER A BIN ICON. A manager in a hurry reads a bin as
 * delete, and a manager who believes the button destroys a punch forever will
 * hesitate over a day that genuinely needs correcting. Nothing here deletes
 * anything: a punch marked wrong is struck through and stays, on screen and on
 * the record, with the reason and the name against it.
 *
 * AND THE PREVIEW NEVER SHOWS A BARE NUMBER. Marking a punch wrong without
 * replacing it leaves the day unpaired, and the hours then fall — correctly,
 * but a smaller figure on its own reads as an answer rather than a warning. So
 * an unpaired day says `incomplete` and names the punch left hanging.
 */
function PunchEditor({
  punches,
  draft,
  onChange,
}: {
  punches: AttendancePunchRow[];
  draft: PunchDraft[];
  onChange: (next: PunchDraft[]) => void;
}) {
  const live = draft.filter((row) => !row.wrong);
  const minutes = (() => {
    const sorted = [...live].sort((a, b) => a.at.localeCompare(b.at));
    let total = 0;
    let open: string | null = null;
    let hanging: PunchDraft | null = null;
    for (const row of sorted) {
      if (row.kind === 'IN') {
        if (open) hanging = row;
        open = row.at;
      } else if (open) {
        const [ah, am] = open.split(':').map(Number);
        const [bh, bm] = row.at.split(':').map(Number);
        total += Math.max(0, bh * 60 + bm - (ah * 60 + am));
        open = null;
      } else {
        hanging = row;
      }
    }
    if (open) hanging = sorted.filter((r) => r.kind === 'IN').reverse()[0] ?? null;
    return { total, hanging };
  })();

  const before = punches.filter((p) => !p.supersededAt).length;
  const wasMinutes = (() => {
    let total = 0;
    let open: Date | null = null;
    for (const row of punches.filter((p) => !p.supersededAt)) {
      if (row.kind === 'IN') open = new Date(row.at);
      else if (open) {
        total += Math.max(0, Math.round((new Date(row.at).getTime() - open.getTime()) / 60000));
        open = null;
      }
    }
    return total;
  })();

  const set = (index: number, patch: Partial<PunchDraft>) =>
    onChange(draft.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <>
      <div className="hr-small hr-muted" style={{ marginBottom: 4 }}>
        The punches as recorded
      </div>
      <div className="hr-punchList">
        {draft.map((row, index) => {
          const stored = punches.find((p) => p.id === row.id);
          return (
            <div key={row.id ?? `new-${index}`} className={`hr-punchRow${row.wrong ? ' hr-punchRow--gone' : ''}`}>
              <span className="hr-punchRow__n">{index + 1}</span>
              <span className="hr-punchRow__kind">{row.kind === 'IN' ? 'In' : 'Out'}</span>
              <span className="hr-punchRow__time">
                <input
                  type="time"
                  className="hr-f"
                  value={row.at}
                  disabled={row.wrong}
                  aria-label={`${row.kind === 'IN' ? 'Clock in' : 'Clock out'} ${index + 1}`}
                  onChange={(event) => set(index, { at: event.target.value })}
                />
              </span>
              <span className="hr-punchRow__meta">
                {row.wrong
                  ? 'marked wrong'
                  : stored?.recordedBy
                    ? `entered by ${stored.recordedBy}`
                    : (stored?.source ?? 'new').toLowerCase()}
              </span>
              <button
                type="button"
                className="hr-punchRow__wrong"
                disabled={row.wrong}
                onClick={() => set(index, { wrong: true })}
              >
                {row.wrong ? '' : 'Wrong'}
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="hr-btn hr-btn--sm"
        onClick={() =>
          onChange([...draft, { at: '', kind: draft.filter((r) => !r.wrong).slice(-1)[0]?.kind === 'IN' ? 'OUT' : 'IN' }])
        }
      >
        + Add a punch
      </button>
      <div className="hr-punchPreview">
        <span>
          <b>Hours after your change</b>{' '}
          {duration(wasMinutes)} → {duration(minutes.total)}
          {minutes.hanging ? ' · incomplete' : ''}
        </span>
        {minutes.hanging ? (
          <span className="hr-punchPreview__warn">
            {minutes.hanging.at || 'A punch'} {minutes.hanging.kind === 'IN' ? 'In' : 'Out'} has no{' '}
            {minutes.hanging.kind === 'IN' ? 'clock-out' : 'clock-in'} — this day will be marked incomplete.
          </span>
        ) : null}
        {before !== live.length ? null : null}
      </div>
    </>
  );
}

/**
 * THE DAY AS ITS PAIRS, which is the whole reason four punches are stored.
 *
 * "8.0 h" is arithmetic; `09:02–13:01 · 14:12–18:03, away 1 h 11 m` is the
 * answer to the question the owner opens this screen with — who left and came
 * back late. The gap is STATED, never judged: nothing here knows how long a
 * break was meant to be, and a column that makes an accusation it cannot
 * support is a column people learn to ignore.
 */
function Punches({ punches, alt }: { punches: AttendancePunchRow[]; alt: string }) {
  const live = punches.filter((p) => !p.supersededAt);
  const gone = punches.filter((p) => p.supersededAt);
  if (punches.length === 0) return <span className="hr-tn">—</span>;

  const pairs: { in: AttendancePunchRow | null; out: AttendancePunchRow | null }[] = [];
  for (const punch of live) {
    const open = pairs[pairs.length - 1];
    if (punch.kind === 'IN' || !open || open.out) pairs.push({ in: punch.kind === 'IN' ? punch : null, out: punch.kind === 'OUT' ? punch : null });
    else open.out = punch;
  }

  const gap = (a: AttendancePunchRow, b: AttendancePunchRow) => {
    const mins = Math.round((new Date(b.at).getTime() - new Date(a.at).getTime()) / 60000);
    if (mins <= 0) return null;
    const h = Math.floor(mins / 60);
    return h > 0 ? `${h} h ${mins % 60} m` : `${mins} m`;
  };

  return (
    <span className="hr-punches">
      {pairs.map((pair, index) => {
        const previous = index > 0 ? pairs[index - 1].out : null;
        const away = previous && pair.in ? gap(previous, pair.in) : null;
        return (
          <span key={pair.in?.id ?? pair.out?.id ?? index}>
            <span className="hr-punchPair">
              {pair.in ? <Punch at={pair.in.at} proof={pair.in.proofUrl} late={false} alt={alt} /> : <span className="hr-tn">—</span>}
              <span className="hr-tn">–</span>
              {pair.out ? <Punch at={pair.out.at} proof={pair.out.proofUrl} late={false} alt={alt} /> : <span className="hr-ts">no clock-out</span>}
            </span>
            {away ? <span className="hr-punchGap">away {away}</span> : null}
          </span>
        );
      })}
      {gone.map((punch) => (
        <span key={punch.id} className="hr-punchPair hr-punch--gone" title={punch.supersededReason ?? undefined}>
          {formatClinicTime(punch.at)} {punch.kind === 'IN' ? 'in' : 'out'} · marked wrong
          {punch.supersededBy ? ` by ${punch.supersededBy}` : ''}
        </span>
      ))}
    </span>
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
