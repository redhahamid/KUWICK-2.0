import dayjs, { Dayjs } from 'dayjs';
import { clinicDayjs, clinicDayjsAtWall } from '../../clinical/clinicTime';

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
  // The anchor names a CALENDAR DATE (whatever zone the picker built it in);
  // the range must cover that date IN THE CLINIC'S ZONE, or a reader west of
  // the clinic fetches a window that misses the clinic's early morning — the
  // 00:30 booking exists, the API was simply never asked for it (D-103).
  const wall = clinicDayjsAtWall(`${anchor.format('YYYY-MM-DD')} 12:00`);
  switch (viewMode) {
    case 'day':
    case 'providers':
      return { start: wall.startOf('day'), end: wall.endOf('day') };
    case 'week': {
      // MONDAY → SUNDAY (approved mockup, week panel: "Mon 17 … Sun 23").
      // Computed EXPLICITLY rather than by moving dayjs's global week start:
      // that locale switch would silently redraw every other week boundary in
      // the product (reports, roster, payroll) to chase a calendar heading.
      // Month view deliberately keeps its Sunday-first grid, as the mockup's
      // own month panel draws it.
      const backToMonday = (wall.day() + 6) % 7;
      const start = wall.subtract(backToMonday, 'day').startOf('day');
      return { start, end: start.add(6, 'day').endOf('day') };
    }
    case 'month':
      return { start: wall.startOf('month'), end: wall.endOf('month') };
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
  // The CLINIC's current calendar date, carried as a plain local dayjs. An
  // owner opening the diary from another timezone at the clinic's 07:00 must
  // land on the clinic's today — the browser's date is a fact about the
  // laptop (RC blocker: the grid anchors everything on this date key).
  return dayjs(clinicDayjs(new Date()).format('YYYY-MM-DD'));
}
