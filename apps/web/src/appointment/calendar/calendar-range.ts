import dayjs, { Dayjs } from 'dayjs';

/**
 * FOUR VIEWS, and each answers a different question.
 *
 *   day        what is happening today, in one column — the receptionist's
 *              running order, and the fastest to read on a narrow screen.
 *   providers  the same day, one column PER PROVIDER. The multi-doctor
 *              clinic's operational view (§9), and the reason `day` is not
 *              simply the provider grid: a single-doctor clinic does not want
 *              a grid with one column in it.
 *   week       the weekly workload.
 *   month      high-level planning, with "+N more" rather than an overloaded
 *              cell.
 */
export type CalendarViewMode = 'day' | 'week' | 'month' | 'providers';

export interface CalendarRange {
  start: Dayjs;
  end: Dayjs;
}

export function getCalendarRange(viewMode: CalendarViewMode, anchor: Dayjs): CalendarRange {
  switch (viewMode) {
    case 'day':
    case 'providers':
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
    case 'providers':
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
