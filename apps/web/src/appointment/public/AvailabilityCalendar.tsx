import { Button, Skeleton, Typography } from 'antd';
import { LeftOutlined, RightOutlined, ThunderboltOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { formatClinicTime } from '../../clinical/clinicTime';
import type { PublicMonthAvailability } from './publicBookingApi';

const { Text } = Typography;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * FINAL-UAT — the colour-coded availability month (target mockup: airline-
 * style date step, and the reschedule flow reuses it unchanged).
 *
 * A patient should see WHERE the room is before tapping anything: green has
 * plenty, amber has a few, grey has none, closed days are simply not offered.
 * Every day's colour is the canonical engine's own per-day answer, served by
 * the month-availability endpoint — this component only paints it.
 */
export interface AvailabilityCalendarProps {
  month: string;
  onMonthChange: (nextMonth: string) => void;
  data?: PublicMonthAvailability;
  loading?: boolean;
  selectedDate?: string | null;
  onSelectDate: (dateKey: string) => void;
  /** The reschedule flow marks the appointment's CURRENT date. */
  markedDate?: string | null;
  /** Months before this one cannot be navigated to (default: current month). */
  minMonth?: string;
  /** "Fastest available" banner — hidden when the month has nothing. */
  fastestNames?: (staffId: string) => string | null;
}

export function AvailabilityCalendar({
  month,
  onMonthChange,
  data,
  loading,
  selectedDate,
  onSelectDate,
  markedDate,
  minMonth,
  fastestNames,
}: AvailabilityCalendarProps) {
  const floorMonth = minMonth ?? dayjs().format('YYYY-MM');
  const first = dayjs(`${month}-01`);
  const padding = first.day();
  const byDate = new Map((data?.days ?? []).map((day) => [day.date, day]));
  const daysInMonth = first.daysInMonth();
  const fastest = data?.fastest ?? null;
  const fastestDoctor = fastest && fastestNames ? fastestNames(fastest.staffId) : null;

  return (
    <div className="kw-avcal" data-testid="availability-calendar">
      {fastest ? (
        <button
          type="button"
          className="kw-avcal-fastest"
          onClick={() => onSelectDate(fastest.date)}
          data-testid="fastest-available"
        >
          <ThunderboltOutlined aria-hidden />
          <span>
            <Text strong>Fastest available</Text>{' '}
            {dayjs(fastest.date).format('ddd, D MMM')} · {formatClinicTime(fastest.start)}
            {fastestDoctor ? ` · ${fastestDoctor}` : ''}
          </span>
        </button>
      ) : null}

      <div className="kw-avcal-head">
        <Button
          size="small"
          type="text"
          icon={<LeftOutlined />}
          aria-label="Previous month"
          disabled={month <= floorMonth}
          onClick={() => onMonthChange(first.subtract(1, 'month').format('YYYY-MM'))}
        />
        <span className="kw-avcal-title">{first.format('MMMM YYYY')}</span>
        <Button
          size="small"
          type="text"
          icon={<RightOutlined />}
          aria-label="Next month"
          onClick={() => onMonthChange(first.add(1, 'month').format('YYYY-MM'))}
        />
      </div>

      <div className="kw-avcal-grid" role="grid" aria-label="Choose a date">
        {WEEKDAYS.map((label) => (
          <span key={label} className="kw-avcal-dow">
            {label}
          </span>
        ))}
        {Array.from({ length: padding }, (_, index) => (
          <span key={`pad-${index}`} aria-hidden />
        ))}
        {Array.from({ length: daysInMonth }, (_, index) => {
          const dateKey = `${month}-${String(index + 1).padStart(2, '0')}`;
          const day = byDate.get(dateKey);
          const status = day?.status ?? (loading ? 'LOADING' : 'PAST');
          const selectable = status === 'AVAILABLE' || status === 'LIMITED';
          const selected = selectedDate === dateKey;
          const marked = markedDate === dateKey;
          return (
            <button
              key={dateKey}
              type="button"
              className="kw-avcal-day"
              data-date={dateKey}
              data-status={status}
              data-selected={selected || undefined}
              data-marked={marked || undefined}
              disabled={!selectable}
              onClick={() => onSelectDate(dateKey)}
              aria-label={`${dayjs(dateKey).format('dddd D MMMM')}${
                day ? ` — ${day.slotCount} time${day.slotCount === 1 ? '' : 's'} free` : ''
              }`}
              title={marked ? 'Your current appointment' : undefined}
            >
              {index + 1}
            </button>
          );
        })}
      </div>

      {loading && !data ? <Skeleton.Button active block style={{ marginTop: 6 }} /> : null}

      <div className="kw-avail-legend" style={{ marginTop: 8 }}>
        <span>
          <span className="kw-avail-dot" data-kind="available" /> Available
        </span>
        <span>
          <span className="kw-avail-dot" data-kind="limited" /> Limited
        </span>
        <span>
          <span className="kw-avail-dot" data-kind="full" /> Full
        </span>
        <span>
          <span className="kw-avail-dot" data-kind="selected" /> Selected
        </span>
        {markedDate ? <span>◦ Current appointment</span> : null}
      </div>
    </div>
  );
}
