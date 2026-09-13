import { useState } from 'react';
import { App } from 'antd';
import dayjs from 'dayjs';
import { clinicDayjs, formatClinicTime } from '../clinical/clinicTime';
import { ApiError } from '../core/api-client';
import { Drawer, Panel, PanelHead, StatusChip } from '../admin/hr/ui';
import { AuthImage } from '../admin/hr/ui';
import { ClockButton } from './clock';
import { myFilePath, useMyAttendance, useMyHome, useMySchedule, useRequestCorrection, type MyAttendanceDay } from './hooks/useMe';
import { PortalEmpty } from './portal';

/**
 * ATTENDANCE — what the clock recorded against the shift that was rostered,
 * a month at a time; the clock button; a correction request per day; and
 * the roster itself, because the shifts are what the punches were measured
 * against and the mockups carry no separate Schedule tab.
 */
export function MyAttendancePage() {
  const { message } = App.useApp();
  const [month, setMonth] = useState(() => dayjs().startOf('month'));
  const from = month.format('YYYY-MM-DD');
  const to = month.endOf('month').format('YYYY-MM-DD');
  const { data, isLoading } = useMyAttendance(from, to);
  const { data: schedule } = useMySchedule(from, to);
  const { data: home } = useMyHome();
  const request = useRequestCorrection();

  const [asking, setAsking] = useState<MyAttendanceDay | null>(null);
  const [clockIn, setClockIn] = useState('');
  const [clockOut, setClockOut] = useState('');
  const [reason, setReason] = useState('');

  const onDuty = home?.clock.onDuty ?? false;
  const time = (value: string | null | undefined) => (value ? formatClinicTime(value) : '—');
  const hours = (minutes: number | null) => (minutes === null ? '—' : `${(minutes / 60).toFixed(2)} h`);
  const distance = (metres: number) => (metres >= 1000 ? `${(metres / 1000).toFixed(1)} km away` : `${metres} m away`);
  // The selfie kept with a punch, read back through the person's own token.
  const proof = (path: string | null, alt: string) => {
    const id = path?.startsWith('/me/files/') ? path.slice('/me/files/'.length) : null;
    return id ? <AuthImage path={myFilePath(id)} alt={alt} className="hr-proof" /> : null;
  };

  const at = (day: string, hhmm: string) =>
    hhmm ? dayjs(`${day}T00:00:00`).hour(Number(hhmm.slice(0, 2))).minute(Number(hhmm.slice(3, 5))).second(0).toISOString() : undefined;

  const submit = async () => {
    if (!asking) return;
    if (reason.trim().length < 5) {
      message.error('A manager has to be able to decide on this. Say what happened.');
      return;
    }
    try {
      await request.mutateAsync({
        attendanceRecordId: asking.id,
        requestedClockInAt: at(asking.workDate, clockIn),
        requestedClockOutAt: at(asking.workDate, clockOut),
        reason: reason.trim(),
      });
      message.success('Sent to your manager.');
      setAsking(null);
      setClockIn('');
      setClockOut('');
      setReason('');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not send that.');
    }
  };

  const statusChip = (day: MyAttendanceDay) => {
    if (day.status === 'LATE') return <StatusChip tone="block">Late {day.lateMinutes} min</StatusChip>;
    if (day.status === 'MISSING_PUNCH') return <StatusChip tone="block">Missing punch</StatusChip>;
    if (day.status === 'ABSENT') return <StatusChip tone="muted">Absent</StatusChip>;
    if (day.status === 'ON_LEAVE') return <StatusChip tone="attn">On leave</StatusChip>;
    if (day.status === 'PRESENT' && day.clockOutAt) return <StatusChip tone="done">On time</StatusChip>;
    return <StatusChip tone="info">{day.status.toLowerCase().replace('_', ' ')}</StatusChip>;
  };

  const shiftsByDay = new Map<string, NonNullable<typeof schedule>['shifts']>();
  for (const shift of schedule?.shifts ?? []) {
    shiftsByDay.set(shift.date, [...(shiftsByDay.get(shift.date) ?? []), shift]);
  }
  const leaveOn = (date: string) => schedule?.leave.find((row) => row.startDate <= date && row.endDate >= date) ?? null;

  return (
    <>
      <div className="hr-pageHead">
        <div>
          <h1>Attendance</h1>
          <div className="hr-sub">
            What the clock recorded against the shift you were rostered for. If a punch is missing or wrong, ask for a
            correction; your manager decides it and the original stays on the record.
          </div>
        </div>
        <div className="hr-pageHead__actions">
          {onDuty ? <span className="hr-clockState">On duty since {time(home?.clock.since)}</span> : null}
          <ClockButton onDuty={onDuty} />
        </div>
      </div>

      <Panel>
        <PanelHead
          title={month.format('MMMM YYYY')}
          actions={
            <span className="hr-dots">
              <button type="button" className="hr-btn hr-btn--sm" onClick={() => setMonth((current) => current.subtract(1, 'month'))} aria-label="Previous month">
                ‹
              </button>
              <button type="button" className="hr-btn hr-btn--sm" onClick={() => setMonth(dayjs().startOf('month'))}>
                This month
              </button>
              <button type="button" className="hr-btn hr-btn--sm" onClick={() => setMonth((current) => current.add(1, 'month'))} aria-label="Next month">
                ›
              </button>
            </span>
          }
        />
        {isLoading ? null : (data?.length ?? 0) === 0 ? (
          <PortalEmpty title="Nothing recorded this month">Attendance starts the first time you clock in.</PortalEmpty>
        ) : (
          <div className="hr-scrollX">
            <table className="hr-table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Rostered</th>
                  <th>Punches</th>
                  <th className="hr-num">Hours</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data?.map((day) => (
                  <tr key={day.id}>
                    <td>
                      <b>{clinicDayjs(`${day.workDate}T00:00:00`).format('ddd D MMM')}</b>
                      {day.extraMinutesRecorded > 0 ? (
                        <div className="hr-tdSub">
                          {(day.extraMinutesRecorded / 60).toFixed(2)} h extra · {day.overtimeApproved ? 'approved as overtime' : 'not yet approved as overtime'}
                        </div>
                      ) : null}
                      {day.correctionRequest ? (
                        <div className="hr-tdSub">
                          Correction {day.correctionRequest.status.toLowerCase()}
                          {day.correctionRequest.decisionNote ? `: ${day.correctionRequest.decisionNote}` : ''}
                        </div>
                      ) : null}
                    </td>
                    <td>{day.scheduledStart ? `${time(day.scheduledStart)}–${time(day.scheduledEnd)}` : <span className="hr-faint">No shift</span>}</td>
                    <td>
                      {/*
                        * EVERY PUNCH OF YOUR OWN DAY, superseded ones included.
                        * "The manager changed my clock-in" is the dispute this
                        * record exists to settle, and it cannot settle it by
                        * hiding the punch that was replaced.
                        */}
                      <span className="hr-punches">
                        {(day.punches ?? []).length === 0 ? <span className="hr-faint">—</span> : null}
                        {(day.punches ?? []).map((punch) => (
                          <span
                            key={punch.id}
                            className={`hr-punchPair${punch.supersededAt ? ' hr-punch--gone' : ''}`}
                            title={punch.supersededReason ?? undefined}
                          >
                            {proof(punch.proofUrl, `${punch.kind === 'IN' ? 'Clock-in' : 'Clock-out'} selfie`)}
                            {time(punch.at)} {punch.kind === 'IN' ? 'in' : 'out'}
                            {punch.supersededAt ? ' · marked wrong' : ''}
                            {punch.recordedBy ? ` · by ${punch.recordedBy}` : ''}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="hr-num">{hours(day.workedMinutes)}</td>
                    <td>
                      <span className="hr-dots">
                        {statusChip(day)}
                        {day.corrected ? <StatusChip tone="info">Corrected</StatusChip> : null}
                        {day.outsideClinic ? (
                          <StatusChip tone="attn">
                            Outside clinic{day.distanceMetres !== null ? ` · ${distance(day.distanceMetres)}` : ''}
                          </StatusChip>
                        ) : null}
                        {day.source === 'MANUAL' ? <StatusChip tone="muted">Entered by HR</StatusChip> : null}
                      </span>
                    </td>
                    <td className="hr-num">
                      {!day.correctionRequest || day.correctionRequest.status !== 'PENDING' ? (
                        <button type="button" className="hr-btn hr-btn--sm" onClick={() => setAsking(day)}>
                          Ask for a fix
                        </button>
                      ) : (
                        <StatusChip tone="attn">Waiting</StatusChip>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel className="hr-mt">
        <PanelHead title="Roster" sub="Published by whoever manages the roster. If something here is wrong, tell them." />
        {schedule && shiftsByDay.size === 0 ? (
          <PortalEmpty title="No shifts published for this month">Shifts appear here as soon as the roster for the month is written.</PortalEmpty>
        ) : (
          <table className="hr-table">
            <tbody>
              {[...shiftsByDay.entries()]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([date, shifts]) => {
                  const leave = leaveOn(date);
                  return (
                    <tr key={date}>
                      <td>
                        <b>{clinicDayjs(`${date}T00:00:00`).format('ddd D MMM')}</b>
                      </td>
                      <td>
                        {shifts.map((shift) => (
                          <div key={shift.id}>
                            {time(shift.startsAt)}–{time(shift.endsAt)}
                            {clinicDayjs(shift.endsAt).format('YYYY-MM-DD') !== date ? ' (next morning)' : ''}
                            {shift.shiftType !== 'WORKING' ? ` · ${shift.shiftType.toLowerCase()}` : ''}
                            {shift.note ? ` · ${shift.note}` : ''}
                          </div>
                        ))}
                      </td>
                      <td>{leave ? <StatusChip tone="attn">{leave.leaveType.toLowerCase()} leave</StatusChip> : null}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        )}
      </Panel>

      <Drawer
        open={Boolean(asking)}
        onClose={() => setAsking(null)}
        title={asking ? `Correction for ${clinicDayjs(`${asking.workDate}T00:00:00`).format('ddd D MMM')}` : ''}
        sub="Say what the times should have been. Leave a box empty if that end of the day is already right."
        footer={
          <>
            <button type="button" className="hr-btn" onClick={() => setAsking(null)}>
              Cancel
            </button>
            <button type="button" className="hr-btn hr-btn--primary" onClick={submit} disabled={request.isPending}>
              Send to my manager
            </button>
          </>
        }
      >
        <div className="hr-pform" style={{ padding: '0 22px 16px' }}>
          <div>
            <label htmlFor="fix-in">Clock in should have been</label>
            <input id="fix-in" type="time" className="hr-f" value={clockIn} onChange={(event) => setClockIn(event.target.value)} />
          </div>
          <div>
            <label htmlFor="fix-out">Clock out should have been</label>
            <input id="fix-out" type="time" className="hr-f" value={clockOut} onChange={(event) => setClockOut(event.target.value)} />
          </div>
          <div className="hr-pform__full">
            <label htmlFor="fix-reason">What happened</label>
            <textarea id="fix-reason" className="hr-f" placeholder="The tablet was offline when I arrived at 8." value={reason} onChange={(event) => setReason(event.target.value)} />
          </div>
        </div>
      </Drawer>
    </>
  );
}
