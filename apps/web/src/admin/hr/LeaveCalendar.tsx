import { useMemo } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import type { LeaveRequest } from '../../hr/types';
import { initialsOf } from './ui/who';

const MARK: Record<string, string> = { ANNUAL: 'A', MEDICAL: 'M', EMERGENCY: 'E', UNPAID: 'U', OTHER: 'O' };

/**
 * WHO IS AWAY WHEN — people down, days across.
 *
 * The same shape as the roster deliberately: a manager comparing "who is off
 * next week" against "who is rostered next week" is reading two grids, and
 * two grids with different geometry are two things to learn.
 *
 * Approved leave is solid; a request nobody has decided is hatched, because
 * drawing them the same way is how a manager rosters around leave that never
 * happens.
 */
export function LeaveCalendar({ month, requests }: { month: Dayjs; requests: LeaveRequest[] }) {
  const days = useMemo(
    () => Array.from({ length: month.daysInMonth() }, (_, index) => month.add(index, 'day')),
    [month],
  );

  const people = useMemo(() => {
    const from = month.format('YYYY-MM-DD');
    const to = month.endOf('month').format('YYYY-MM-DD');
    const map = new Map<string, { name: string; spans: LeaveRequest[] }>();
    for (const row of requests) {
      if (row.status === 'REJECTED') continue;
      if (row.endDate.slice(0, 10) < from || row.startDate.slice(0, 10) > to) continue;
      const bucket = map.get(row.staffId) ?? { name: row.staff?.fullName ?? '—', spans: [] };
      bucket.spans.push(row);
      map.set(row.staffId, bucket);
    }
    return [...map.entries()]
      .map(([staffId, value]) => ({ staffId, ...value }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [requests, month]);

  if (people.length === 0) {
    return <div className="hr-empty">Nobody is on leave in {month.format('MMMM YYYY')}.</div>;
  }

  return (
    <div className="hr-scrollX">
      <table className="hr-cal">
        <thead>
          <tr>
            <th className="hr-cal__nameHead">Employee</th>
            {days.map((day) => (
              <th key={day.format('YYYY-MM-DD')} className={day.day() === 0 ? 'hr-cal__day is-closed' : 'hr-cal__day'}>
                <span className="hr-cal__dayNum">{day.format('D')}</span>
                <span className="hr-cal__dayName">{day.format('dd')}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {people.map((person) => (
            <tr key={person.staffId}>
              <th className="hr-cal__name">
                <span className="hr-who">
                  <span className="hr-who__avatar">{initialsOf(person.name)}</span>
                  <span className="hr-who__name">{person.name}</span>
                </span>
              </th>
              {days.map((day) => {
                const key = day.format('YYYY-MM-DD');
                const span = person.spans.find(
                  (row) => row.startDate.slice(0, 10) <= key && row.endDate.slice(0, 10) >= key,
                );
                return (
                  <td
                    key={key}
                    className={[
                      'hr-cal__cell',
                      day.day() === 0 ? 'is-closed' : '',
                      span ? (span.status === 'APPROVED' ? 'is-away' : 'is-waiting') : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    title={span ? `${span.leaveType.toLowerCase()} leave · ${span.status.toLowerCase()}` : undefined}
                  >
                    {span ? <span className="hr-cal__mark">{MARK[span.leaveType] ?? '•'}</span> : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="hr-tableFoot">
        <span>A · annual &nbsp; M · medical &nbsp; E · emergency &nbsp; U · unpaid &nbsp; O · other</span>
        <span className="hr-tn">{dayjs(month).format('MMMM YYYY')}</span>
      </div>
    </div>
  );
}
