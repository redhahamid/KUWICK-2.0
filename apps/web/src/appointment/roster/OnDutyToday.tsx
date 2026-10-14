import { Alert, Empty, Spin, Tag } from 'antd';
import dayjs from 'dayjs';
import { useWorkforceToday } from '../../admin/hooks/useAdmin';
import type { WorkforceToday } from '../../admin/types';
import { clinicDayjs, formatClinicTime } from '../../clinical/clinicTime';

type Scheduled = WorkforceToday['scheduled'][number];

/**
 * ON DUTY TODAY (UAT, 14 October 2026): "a combined 'on duty today' view",
 * doctors and staff together, from the roster. Working and locum shifts only,
 * and last night's shifts still running count as today's. Each person says
 * whether they have clocked in, are on leave, or are still to come.
 */
export function OnDutyToday({ clinicId }: { clinicId?: string }) {
  const today = useWorkforceToday(clinicId);
  if (today.isError) {
    return <Alert type="info" showIcon message="Today's board needs HR access." />;
  }
  if (!today.data) return <Spin />;
  const rows = today.data.scheduled;
  if (rows.length === 0) return <Empty description="Nobody is rostered to work today." />;
  const branches = new Set(rows.map((row) => row.clinicId)).size;
  return (
    <div className="kw-onduty" data-testid="on-duty-today">
      <p className="kw-roster-explain">
        {dayjs(today.data.date).format('dddd, D MMMM YYYY')} · {rows.length} rostered
        {branches > 1 ? ` across ${branches} branches` : ''}
      </p>
      {(['DOCTOR', 'STAFF'] as const).map((group) => {
        const people = rows.filter((row) => (row.group ?? 'STAFF') === group);
        if (people.length === 0) return null;
        return (
          <section key={group} className="kw-onduty__group" aria-label={group === 'DOCTOR' ? 'Doctors' : 'Staff'}>
            <h3 className="kw-onduty__title">
              {group === 'DOCTOR' ? 'Doctors' : 'Staff'} <span className="kw-onduty__count">{people.length}</span>
            </h3>
            <ul className="kw-onduty__list">
              {people.map((row, index) => (
                <li key={`${row.staffId}-${index}`} className="kw-onduty__row">
                  <span className="kw-onduty__swatch" style={{ background: row.template?.colour ?? '#1d4ed8' }} aria-hidden="true" />
                  <span className="kw-onduty__name">{row.name}</span>
                  <span className="kw-onduty__shift">
                    {row.template ? `${row.template.name} · ` : ''}
                    {formatClinicTime(row.startAt)}–{formatClinicTime(row.endAt)}
                    {row.fromYesterday ? ' (from yesterday)' : clinicDayjs(row.endAt).isAfter(clinicDayjs(row.startAt), 'day') ? ' (ends tomorrow)' : ''}
                  </span>
                  {row.clinicName && branches > 1 ? <span className="kw-onduty__branch">{row.clinicName}</span> : null}
                  <span className="kw-onduty__state">{stateOf(row)}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function stateOf(row: Scheduled) {
  if (row.onLeave) return <Tag color="purple">On leave</Tag>;
  if (row.clockedIn) return <Tag color="green">In</Tag>;
  if (dayjs(row.startAt).isBefore(dayjs())) return <Tag color="red">Not in yet</Tag>;
  return <Tag>Due {formatClinicTime(row.startAt)}</Tag>;
}
