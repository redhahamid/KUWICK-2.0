import { useMemo } from 'react';
import { Typography } from 'antd';
import { AppointmentStatus } from '@kuwick/shared';
import { Appointment } from '../types';

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
 * — so they can never disagree with it. The List view's figures come from the
 * server instead, because those describe a PERIOD rather than a view, and two
 * different questions deserve two different answers rather than one wrong one.
 */
export function CalendarMetrics({ appointments }: { appointments: Appointment[] }) {
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

  const items: { label: string; value: number; tone?: string }[] = [
    { label: 'Booked', value: counts.booked },
    { label: 'Arrived', value: counts.arrived },
    { label: 'Waiting', value: counts.waiting, tone: '#0f766e' },
    { label: 'Completed', value: counts.completed, tone: '#166534' },
    { label: 'No-show', value: counts.noShow, tone: counts.noShow > 0 ? '#b42318' : undefined },
  ];

  return (
    <div className="kw-calendar-metrics" data-testid="calendar-metrics">
      {items.map((item) => (
        <span key={item.label} className="kw-metric">
          <Text strong style={{ color: item.tone }}>
            {item.value}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {item.label}
          </Text>
        </span>
      ))}
    </div>
  );
}
