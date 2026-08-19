import dayjs, { Dayjs } from 'dayjs';

/**
 * DAY is the provider grid — one column per selected doctor.
 *
 * There used to be a fourth mode, `provider`, rendering exactly that while
 * `day` rendered a single undifferentiated column. Two modes for one view is a
 * choice nobody wants to make, and the plain day column answered a question
 * ("what is happening today, in aggregate") that the week view already answers
 * better.
 */
export type CalendarViewMode = 'day' | 'week' | 'month';

export interface CalendarRange {
  start: Dayjs;
  end: Dayjs;
}

export function getCalendarRange(viewMode: CalendarViewMode, anchor: Dayjs): CalendarRange {
  switch (viewMode) {
    case 'day':
      return { start: anchor.startOf('day'), end: anchor.endOf('day') };
    case 'week':
      // Sunday-Saturday, matching the audited Yezza patient calendar
      // (docs/PROPOSED_ADDENDUM_2026-07-30_appointment-yezza-gaps.md source)
      // and dayjs's default English-locale week start.
      return { start: anchor.startOf('week'), end: anchor.endOf('week') };
    case 'month':
      return { start: anchor.startOf('month'), end: anchor.endOf('month') };
  }
}

export function shiftAnchor(viewMode: CalendarViewMode, anchor: Dayjs, direction: 1 | -1): Dayjs {
  switch (viewMode) {
    case 'day':
      return anchor.add(direction, 'day');
    case 'week':
      return anchor.add(direction, 'week');
    case 'month':
      return anchor.add(direction, 'month');
  }
}

export function todayAnchor(): Dayjs {
  return dayjs();
}
