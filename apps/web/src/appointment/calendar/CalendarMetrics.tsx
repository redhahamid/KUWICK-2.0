import { useMemo } from 'react';
import { Typography } from 'antd';
import { AppointmentStatus } from '@kuwick/shared';
import { Appointment } from '../types';
import { METRIC_COLORS } from '../shared/appointment-colors';

const { Text } = Typography;

/**
 * THE OPERATIONAL COUNTS, in one compact strip (§7).
 *
 * Explicitly NOT giant KPI cards. On a receptionist's screen the calendar is
 * the work and these are context; five 120-pixel cards push the first
 * appointment of the day below the fold, which is the one thing that must not
 * happen. One line, small type, no boxes.
 *
 * Counted CLIENT-SIDE from the appointments already on screen, deliberately.
 * These describe exactly what the calendar is showing — including its filters
 * — so they can never disagree with it. (Phase 3I closed the gap between that
 * sentence and the code: the workspace now hands this the FILTERED set, and
 * the strip says "Filtered" so a narrowed diary cannot pass for a quiet one.)
 * The List view's figures come from the server instead, because those
 * describe a PERIOD rather than a view, and two different questions deserve
 * two different answers rather than one wrong one.
 */
export function CalendarMetrics({
  appointments,
  filtered = false,
  bar = false,
}: {
  appointments: Appointment[];
  filtered?: boolean;
  /**
   * Final visual pass — the same counts rendered a second time as the
   * mockup's status-summary bar under the grid. Presentation only, and no
   * testid on this instance: the filter-bar strip stays the one the tests
   * (and the "Filtered" flag) address.
   */
  bar?: boolean;
}) {
  const counts = useMemo(() => {
    const tally = {
      booked: 0,
      arrived: 0,
      waiting: 0,
      completed: 0,
      noShow: 0,
    };
    for (const appointment of appointments) {
      switch (appointment.status) {
        case AppointmentStatus.CONFIRMED:
        case AppointmentStatus.REMINDED:
        case AppointmentStatus.REQUESTED:
          tally.booked += 1;
          break;
        case AppointmentStatus.ARRIVED:
          tally.arrived += 1;
          break;
        case AppointmentStatus.CHECKED_IN:
        case AppointmentStatus.IN_QUEUE:
          tally.waiting += 1;
          break;
        case AppointmentStatus.COMPLETED:
          tally.completed += 1;
          break;
        case AppointmentStatus.NO_SHOW:
          tally.noShow += 1;
          break;
      }
    }
    return tally;
  }, [appointments]);

  // The dot previews the status tone; the word beside it carries the meaning
  // (colour never alone). Muted dots for zero counts keep the row calm.
  const items: { label: string; value: number; dot: string }[] = [
    { label: 'Booked', value: counts.booked, dot: METRIC_COLORS.booked },
    { label: 'Arrived', value: counts.arrived, dot: METRIC_COLORS.arrived },
    { label: 'Waiting', value: counts.waiting, dot: METRIC_COLORS.waiting },
    { label: 'Completed', value: counts.completed, dot: METRIC_COLORS.completed },
    { label: 'No-show', value: counts.noShow, dot: METRIC_COLORS.noShow },
  ];

  return (
    <div
      className={'kw-calendar-metrics' + (bar ? ' kw-calendar-metrics--bar' : '')}
      data-testid={bar ? undefined : 'calendar-metrics'}
    >
      {filtered ? <span className="kw-metric-filtered">Filtered</span> : null}
      {items.map((item) => (
        <span key={item.label} className="kw-metric">
          <span
            className="kw-metric-dot"
            style={{ background: item.value > 0 ? item.dot : undefined }}
            aria-hidden
          />
          <Text className="kw-metric-value">{item.value}</Text>
          <Text className="kw-metric-label">{item.label}</Text>
        </span>
      ))}
    </div>
  );
}
