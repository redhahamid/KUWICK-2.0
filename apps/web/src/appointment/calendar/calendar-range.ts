import dayjs, { Dayjs } from 'dayjs';

export type CalendarViewMode = 'day' | 'week' | 'month' | 'provider';

export interface CalendarRange {
  start: Dayjs;
  end: Dayjs;
}

// Provider view is Day's grid rendered as one column per doctor instead of
// one column for the clinic, so it covers the same single-day range.
export function getCalendarRange(viewMode: CalendarViewMode, anchor: Dayjs): CalendarRange {
  switch (viewMode) {
    case 'day':
    case 'provider':
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
    case 'provider':
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
