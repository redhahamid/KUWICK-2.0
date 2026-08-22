import { useMemo } from 'react';
import { Typography } from 'antd';
import dayjs from 'dayjs';
import { AppointmentStatus } from '@kuwick/shared';
import { Appointment } from '../types';
import { RangeShift } from '../hooks/useRoster';
import { useAppointmentDashboard } from '../hooks/useAppointmentDashboard';
import { PersonAvatar } from '../shared/PersonAvatar';
import { RELEASED_STATUSES } from '../appointment-status.constants';

const { Text } = Typography;

/**
 * THE PROVIDERS VIEW'S LEFT RAIL (final UAT redesign, target mockup 3).
 *
 * The multi-doctor clinic's operational question is "how is each doctor's
 * day", so the Providers view gets a person list and a day summary beside the
 * grid — INSIDE the module's existing canvas, not an app-level sidebar.
 * Selecting a person drives the SAME provider filter the filter bar owns, so
 * the rail, the chips and the grid can never disagree.
 *
 * The numbers are honest about their sources: counts come from the events the
 * grid is showing; Booked value comes from the server's own stats endpoint
 * (the §46 figure, never recomputed client-side); utilisation is booked
 * minutes over rostered minutes and only speaks when exactly one provider is
 * selected and the roster actually has minutes for them.
 */
export interface ProviderRailProps {
  clinicId?: string;
  providers: { id: string; fullName: string }[];
  /** The day's appointments AFTER the workspace filters — what the grid shows. */
  appointments: Appointment[];
  shifts: RangeShift[];
  /** Clinic-date keys (YYYY-MM-DD) — the dashboard endpoint's own format. */
  rangeFrom: string;
  rangeTo: string;
  selection: string[];
  onSelect: (ids: string[]) => void;
}

function minutesBetween(startIso: string, endIso: string): number {
  return Math.max(0, dayjs(endIso).diff(dayjs(startIso), 'minute'));
}

export function ProviderRail({
  clinicId,
  providers,
  appointments,
  shifts,
  rangeFrom,
  rangeTo,
  selection,
  onSelect,
}: ProviderRailProps) {
  const single = selection.length === 1 ? selection[0] : null;

  const countsByProvider = useMemo(() => {
    const map = new Map<string, number>();
    for (const appointment of appointments) {
      map.set(appointment.staffId, (map.get(appointment.staffId) ?? 0) + 1);
    }
    return map;
  }, [appointments]);

  const scoped = useMemo(
    () =>
      selection.length === 0
        ? appointments
        : appointments.filter((appointment) => selection.includes(appointment.staffId)),
    [appointments, selection],
  );

  const summary = useMemo(() => {
    const tally = { total: 0, completed: 0, noShow: 0, waiting: 0 };
    let bookedMinutes = 0;
    for (const appointment of scoped) {
      tally.total += 1;
      if (appointment.status === AppointmentStatus.COMPLETED) tally.completed += 1;
      if (appointment.status === AppointmentStatus.NO_SHOW) tally.noShow += 1;
      if (
        appointment.status === AppointmentStatus.ARRIVED ||
        appointment.status === AppointmentStatus.CHECKED_IN ||
        appointment.status === AppointmentStatus.IN_QUEUE
      ) {
        tally.waiting += 1;
      }
      if (!RELEASED_STATUSES.includes(appointment.status)) {
        bookedMinutes += minutesBetween(appointment.scheduledStart, appointment.scheduledEnd);
      }
    }
    let utilisation: number | null = null;
    if (single) {
      const rosteredMinutes = shifts
        .filter((shift) => shift.staffId === single && shift.shiftType === 'WORKING')
        .reduce((sum, shift) => sum + minutesBetween(shift.startsAt, shift.endsAt), 0);
      if (rosteredMinutes > 0) {
        utilisation = Math.min(1, bookedMinutes / rosteredMinutes);
      }
    }
    return { ...tally, utilisation };
  }, [scoped, shifts, single]);

  // §46 — Booked value is the server's figure, filtered to the same day (and
  // provider, when one is selected). tab only picks ROWS; stats describe the
  // whole range, which is exactly what the summary wants.
  const { data: dashboard } = useAppointmentDashboard({
    clinicId,
    from: rangeFrom,
    to: rangeTo,
    tab: 'UPCOMING',
    staffId: single ?? undefined,
  });
  const bookedValue = dashboard?.stats.bookedValue;

  const scopeName = single
    ? (providers.find((provider) => provider.id === single)?.fullName ?? 'Provider')
    : selection.length > 1
      ? `${selection.length} providers`
      : 'All providers';

  return (
    <aside className="kw-provider-rail" data-testid="provider-rail">
      <div className="kw-provider-rail-list" role="listbox" aria-label="Providers">
        <button
          type="button"
          className="kw-provider-rail-row"
          data-active={selection.length === 0 || undefined}
          onClick={() => onSelect([])}
        >
          <span className="kw-provider-rail-all" aria-hidden>
            ⌂
          </span>
          <span className="kw-provider-rail-name">All providers</span>
          <span className="kw-provider-rail-count">{appointments.length}</span>
        </button>
        {providers.map((provider) => (
          <button
            key={provider.id}
            type="button"
            className="kw-provider-rail-row"
            data-active={selection.includes(provider.id) || undefined}
            onClick={() =>
              onSelect(selection.length === 1 && selection[0] === provider.id ? [] : [provider.id])
            }
          >
            <PersonAvatar name={provider.fullName} colorSeed={provider.id} size="sm" />
            <span className="kw-provider-rail-name" title={provider.fullName}>
              {provider.fullName}
            </span>
            <span className="kw-provider-rail-count">
              {countsByProvider.get(provider.id) ?? 0}
            </span>
          </button>
        ))}
      </div>

      <div className="kw-provider-summary" data-testid="provider-summary">
        <Text className="kw-provider-summary-scope" title={scopeName}>
          {scopeName}
        </Text>
        <dl>
          <div>
            <dt>Appointments</dt>
            <dd>{summary.total}</dd>
          </div>
          {typeof bookedValue === 'number' ? (
            <div>
              <dt>Booked value</dt>
              <dd>
                RM{' '}
                {bookedValue.toLocaleString('en-MY', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </dd>
            </div>
          ) : null}
          <div>
            <dt>In clinic</dt>
            <dd>{summary.waiting}</dd>
          </div>
          <div>
            <dt>Completed</dt>
            <dd>{summary.completed}</dd>
          </div>
          <div>
            <dt>No-show</dt>
            <dd>{summary.noShow}</dd>
          </div>
        </dl>
        {summary.utilisation != null ? (
          <div className="kw-provider-utilisation">
            <span className="kw-provider-utilisation-head">
              <Text>Utilisation</Text>
              <Text>{Math.round(summary.utilisation * 100)}%</Text>
            </span>
            <span className="kw-provider-utilisation-track" aria-hidden>
              <span style={{ width: `${Math.round(summary.utilisation * 100)}%` }} />
            </span>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
