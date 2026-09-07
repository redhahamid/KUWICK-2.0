import { useState } from 'react';
import { Button, DatePicker, Tag } from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import { clinicDayjs, formatClinicTime } from '../clinical/clinicTime';
import { MyEmpty } from './MyKuwickLayout';
import { useMySchedule } from './hooks/useMe';

/**
 * MY SCHEDULE — the shifts the roster has for me, and the days I am away.
 *
 * Read-only, and it says so. The roster is written by whoever manages it; an
 * employee changing their own shift would be a second answer to who is on
 * duty, which is the failure the single canonical roster exists to prevent.
 */
export function MySchedulePage() {
  const [month, setMonth] = useState<Dayjs>(() => dayjs().startOf('month'));
  const from = month.format('YYYY-MM-DD');
  const to = month.endOf('month').format('YYYY-MM-DD');
  const { data, isLoading } = useMySchedule(from, to);

  // The clinic's zone, for the same reason MyHomePage gives.
  const time = (value: string) => formatClinicTime(value);
  const leaveOn = (date: string) =>
    data?.leave.find((row) => row.startDate <= date && row.endDate >= date) ?? null;
  const closureOn = (date: string) => data?.closures.find((row) => row.date === date) ?? null;

  // Grouped by day, so a split shift reads as one day with two lines rather
  // than as two unrelated rows.
  const days = new Map<string, typeof data extends undefined ? never : NonNullable<typeof data>['shifts']>();
  for (const shift of data?.shifts ?? []) {
    days.set(shift.date, [...(days.get(shift.date) ?? []), shift]);
  }

  return (
    <>
      <div>
        <h1 className="kw-my__title">My schedule</h1>
        <p className="kw-my__subtitle">
          Published by whoever manages the roster. If something here is wrong, tell them — this screen does
          not change it.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button onClick={() => setMonth((current) => current.add(-1, 'month'))}>Previous</Button>
        <DatePicker picker="month" value={month} allowClear={false} onChange={(value) => value && setMonth(value.startOf('month'))} />
        <Button onClick={() => setMonth((current) => current.add(1, 'month'))}>Next</Button>
      </div>

      <div className="kw-my-card kw-my-card--flush">
        {isLoading ? null : days.size === 0 && (data?.leave.length ?? 0) === 0 ? (
          <MyEmpty title="No shifts published for this month">
            Shifts appear here as soon as the roster for the month is written.
          </MyEmpty>
        ) : (
          [...days.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, shifts]) => {
              const leave = leaveOn(date);
              const closure = closureOn(date);
              return (
                <div className="kw-my-row" key={date}>
                  <div className="kw-my-row__main">
                    <span className="kw-my-row__title">{clinicDayjs(`${date}T00:00:00`).format('ddd D MMM')}</span>
                    {shifts.map((shift) => (
                      <span className="kw-my-row__detail" key={shift.id}>
                        {time(shift.startsAt)} – {time(shift.endsAt)}
                        {/* A 23:00–07:00 shift is ONE shift; saying so stops it
                            reading as a typo. */}
                        {clinicDayjs(shift.endsAt).format('YYYY-MM-DD') !== date ? ' (next morning)' : ''}
                        {shift.shiftType !== 'WORKING' ? ` · ${shift.shiftType.toLowerCase()}` : ''}
                        {shift.note ? ` · ${shift.note}` : ''}
                      </span>
                    ))}
                    {closure ? (
                      <span className="kw-my-row__detail">Clinic closed{closure.reason ? `: ${closure.reason}` : ''}</span>
                    ) : null}
                  </div>
                  <div className="kw-my-row__side">
                    {leave ? <Tag color="gold">{leave.leaveType.toLowerCase()}</Tag> : null}
                  </div>
                </div>
              );
            })
        )}
      </div>

      {(data?.leave.length ?? 0) > 0 ? (
        <div className="kw-my-card">
          <div className="kw-my-card__label">Approved leave this month</div>
          {data?.leave.map((row) => (
            <div className="kw-my-shift" key={`${row.leaveType}-${row.startDate}`}>
              <span className="kw-my-shift__time">
                {clinicDayjs(`${row.startDate}T00:00:00`).format('D MMM')} – {clinicDayjs(`${row.endDate}T00:00:00`).format('D MMM')}
              </span>
              <Tag color="gold">{row.leaveType.toLowerCase()}</Tag>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
