import { App, Button, Tag } from 'antd';
import dayjs from 'dayjs';
import { clinicDayjs, formatClinicTime } from '../clinical/clinicTime';
import { Link } from 'react-router-dom';
import { ApiError } from '../core/api-client';
import { MyEmpty } from './MyKuwickLayout';
import { useClockSelf, useMyHome } from './hooks/useMe';

/**
 * THE SCREEN A MEMBER OF STAFF OPENS ON THEIR PHONE.
 *
 * Not a grid of counters. It answers, in the order somebody actually asks:
 * am I clocked in, what am I meant to be doing today, what is waiting on
 * somebody else, and where is my last payslip.
 */
export function MyHomePage() {
  const { message } = App.useApp();
  const { data, isLoading } = useMyHome();
  const clock = useClockSelf();

  const onClock = async () => {
    try {
      await clock.mutateAsync({});
      message.success(data?.clock.onDuty ? 'Clocked out. Have a good evening.' : 'Clocked in.');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not record that.');
    }
  };

  // THE CLINIC'S ZONE, NOT THE PHONE'S. An 09:00 Malaysian shift rendered
  // through a browser sitting in UTC reads as 01:00, and a member of staff
  // checking their shift on holiday would see a different start time from the
  // colleague standing in the clinic. `clinicTime` is the product's one answer
  // to this and already carries the reasoning.
  const time = (value: string | null | undefined) => (value ? formatClinicTime(value) : '—');
  const onDuty = data?.clock.onDuty ?? false;

  return (
    <>
      <div className="kw-my-card kw-my-clock">
        <div>
          <div className="kw-my-card__label">{onDuty ? 'On duty' : 'Not clocked in'}</div>
          <div className="kw-my-clock__state">
            <span className="kw-my-clock__now">{onDuty ? `Since ${time(data?.clock.since)}` : 'Ready'}</span>
            {/*
              * An overnight shift's clock-in belongs to the day it started, so
              * a night nurse clocking out at 07:00 is closing YESTERDAY. Saying
              * so is the difference between a clear screen and a support call.
              */}
            {onDuty && data?.clock.openSince && data.clock.openSince !== data.date ? (
              <Tag color="blue">Shift started {clinicDayjs(`${data.clock.openSince}T00:00:00`).format('D MMM')}</Tag>
            ) : null}
          </div>
        </div>
        <Button
          type="primary"
          className="kw-my-clock__button"
          size="large"
          block
          loading={clock.isPending}
          onClick={onClock}
          danger={onDuty}
        >
          {onDuty ? 'Clock out' : 'Clock in'}
        </Button>
      </div>

      <div className="kw-my-card">
        <div className="kw-my-card__label">Today · {clinicDayjs(`${data?.date ?? ''}T00:00:00`).format('ddd D MMM')}</div>
        {isLoading ? null : (data?.todayShifts?.length ?? 0) === 0 ? (
          <MyEmpty title="Nothing scheduled for you today">
            {data?.nextShift
              ? `Your next shift is ${clinicDayjs(`${data.nextShift.date}T00:00:00`).format('ddd D MMM')}, ${time(data.nextShift.startsAt)}–${time(data.nextShift.endsAt)}.`
              : 'When your manager publishes the roster, your shifts appear here.'}
          </MyEmpty>
        ) : (
          data?.todayShifts.map((shift) => (
            <div className="kw-my-shift" key={shift.id}>
              <div>
                <div className="kw-my-shift__time">
                  {time(shift.startsAt)} – {time(shift.endsAt)}
                </div>
                {shift.note ? <div className="kw-my-shift__meta">{shift.note}</div> : null}
              </div>
              {shift.shiftType !== 'WORKING' ? <Tag>{shift.shiftType}</Tag> : null}
            </div>
          ))
        )}
        {data?.upcomingLeave ? (
          <div className="kw-my-shift__meta" style={{ marginTop: 8 }}>
            Approved leave: {data.upcomingLeave.leaveType.toLowerCase()},{' '}
            {clinicDayjs(`${data.upcomingLeave.startDate}T00:00:00`).format('D MMM')} – {clinicDayjs(`${data.upcomingLeave.endDate}T00:00:00`).format('D MMM')}
          </div>
        ) : null}
      </div>

      <div>
        <div className="kw-my-card__label" style={{ marginBottom: 6 }}>
          Waiting on somebody else
        </div>
        <div className="kw-my-waiting">
          {/* Each tile is a link, because a number that leads nowhere is a
              number nobody can act on. */}
          <Link className="kw-my-waiting__tile" to="/my/leave">
            <span className="kw-my-waiting__count">{data?.waiting.leaveRequests ?? 0}</span>
            <span className="kw-my-waiting__label">Leave requests</span>
          </Link>
          <Link className="kw-my-waiting__tile" to="/my/claims">
            <span className="kw-my-waiting__count">{data?.waiting.claims ?? 0}</span>
            <span className="kw-my-waiting__label">Claims</span>
          </Link>
          <Link className="kw-my-waiting__tile" to="/my/attendance">
            <span className="kw-my-waiting__count">{data?.waiting.attendanceCorrections ?? 0}</span>
            <span className="kw-my-waiting__label">Attendance fixes</span>
          </Link>
        </div>
      </div>

      <div className="kw-my-card">
        <div className="kw-my-card__label">Latest payslip</div>
        {data?.latestPayslip ? (
          <div className="kw-my-shift">
            <div>
              <div className="kw-my-shift__time">{clinicDayjs(data.latestPayslip.period).format('MMMM YYYY')}</div>
              <div className="kw-my-shift__meta">{data.latestPayslip.status === 'PAID' ? 'Paid' : 'Approved'}</div>
            </div>
            <Link to="/my/payslips">Open</Link>
          </div>
        ) : (
          <MyEmpty title="No payslip yet">
            A payslip appears here once a month's payroll has been approved. A month still being worked on is
            not shown, because the figures in it can still change.
          </MyEmpty>
        )}
      </div>
    </>
  );
}
