import dayjs from 'dayjs';
import { dayjsLocalizer } from 'react-big-calendar';

/**
 * RC BLOCKER FIX — THE LOCALIZER MUST NOT SEE `dayjs.tz`.
 *
 * The diary's whole timezone convention (D-103) is: react-big-calendar
 * positions and labels by a Date's PLAIN LOCAL FIELDS, and the app feeds it
 * pseudo-Dates whose local fields equal the clinic wall clock. That
 * convention silently broke the moment the shared dayjs instance carried the
 * timezone plugin, because `dayjsLocalizer` switches on it:
 *
 *     var dayjs = dayjsLib.tz ? dayjsLib.tz : dayjsLib;   // rbc source
 *
 * and its tz path round-trips `merge()` through a STRING that `dayjs.tz`
 * parses as UTC. Measured, not assumed — on a browser in Asia/Kuala_Lumpur:
 *
 *     localizer.merge(26 Aug 07:00 local) === 25 Aug 23:00 local
 *
 * minus the UTC offset, previous calendar date. Every day-column's min/max
 * went through that, so on any non-UTC device the axis rendered wrapped:
 * 11:00 PM → 12:00 AM → … → 12:30 PM — the exact live-iPad defect. (In a
 * UTC browser the shift is zero, which is why UTC-based CI and screenshots
 * could not see it.)
 *
 * The facade is a LIVE PROXY, not a snapshot: `dayjsLocalizer` itself
 * extends more plugins (minMax and friends) onto the real dayjs during
 * construction and then calls `dayjsLib.max(...)`, so a copied-statics
 * facade is missing them and white-screens the grid ("e.max is not a
 * function"). The proxy forwards every static to the live dayjs — except
 * `tz`, which it denies — so rbc takes its plain local-field branch in
 * every zone while the app's own dayjs keeps its plugins untouched.
 */
const localizerDayjs = new Proxy(
  ((...args: Parameters<typeof dayjs>) => dayjs(...args)) as typeof dayjs,
  {
    apply: (_target, _thisArg, args: Parameters<typeof dayjs>) => dayjs(...args),
    get: (_target, prop) => {
      if (prop === 'tz') return undefined;
      const value = (dayjs as unknown as Record<PropertyKey, unknown>)[prop];
      return typeof value === 'function'
        ? (value as (...fnArgs: unknown[]) => unknown).bind(dayjs)
        : value;
    },
    has: (_target, prop) => (prop === 'tz' ? false : prop in dayjs),
  },
);

export { localizerDayjs };

export const calendarLocalizer = dayjsLocalizer(localizerDayjs);

/**
 * THE WEEK VIEW'S OWN LOCALIZER — Monday → Sunday (approved mockup).
 *
 * react-big-calendar decides a week's span in `Week.range` via
 * `localizer.startOf(date, 'week', localizer.startOfWeek())`, and the dayjs
 * localizer's `startOf` IGNORES that third argument — it delegates straight
 * to `dayjs(date).startOf('week')`, i.e. the GLOBAL dayjs locale. So there
 * are only two ways to move the week boundary: move the global locale, or
 * give the week view a localizer of its own.
 *
 * Moving the global locale was refused: dayjs's week start is read all over
 * this product (reports, roster, payroll periods), and silently shifting all
 * of them to satisfy a calendar heading is exactly the kind of blast radius
 * a presentation pass must not have. So the WEEK view — and nothing else —
 * gets this instance. Month keeps its Sunday-first grid (its own mockup
 * panel draws it that way) because rbc's month path calls `firstVisibleDay`,
 * which never consults `startOfWeek` at all.
 *
 * The arithmetic is local-field only, exactly like gridWindow/gridDateAt: the
 * Dates rbc handles are pseudo-dates whose LOCAL fields are the clinic wall
 * clock (D-103), so a Monday computed with getDay()/getDate() is the clinic's
 * Monday in every browser zone. Nothing here touches the timezone facade
 * above, the grid bounds, or the axis policy.
 */
const MONDAY = 1;

function mondayStartOfWeek(value: Date): Date {
  const date = new Date(value);
  const backToMonday = (date.getDay() + 6) % 7; // Mon → 0 … Sun → 6
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() - backToMonday,
    0,
    0,
    0,
    0,
  );
}

function mondayEndOfWeek(value: Date): Date {
  const start = mondayStartOfWeek(value);
  return new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate() + 6,
    23,
    59,
    59,
    999,
  );
}

export const weekCalendarLocalizer = (() => {
  const localizer = dayjsLocalizer(localizerDayjs);
  const baseStartOf = localizer.startOf;
  const baseEndOf = localizer.endOf;
  localizer.startOfWeek = () => MONDAY;
  // The library types `startOf`/`endOf` as OVERLOADS — one accepting 'week'
  // with a first-day argument, one accepting the other units — which no
  // single wrapper signature satisfies. So the wrapper takes the union and
  // the deferral is cast once, here, rather than at every call site:
  // behaviour is unchanged for every unit except 'week'.
  type DateUnit = 'week' | 'day' | 'month' | 'year' | 'hours' | 'minutes' | 'seconds';
  type AnyUnitFn = (date: Date, unit: DateUnit, firstOfWeek?: number) => Date;
  const deferStartOf = baseStartOf as unknown as AnyUnitFn;
  const deferEndOf = baseEndOf as unknown as AnyUnitFn;
  localizer.startOf = ((date: Date, unit: DateUnit, firstOfWeek?: number) =>
    unit === 'week' && date
      ? mondayStartOfWeek(date)
      : deferStartOf(date, unit, firstOfWeek)) as typeof localizer.startOf;
  localizer.endOf = ((date: Date, unit: DateUnit, firstOfWeek?: number) =>
    unit === 'week' && date
      ? mondayEndOfWeek(date)
      : deferEndOf(date, unit, firstOfWeek)) as typeof localizer.endOf;
  return localizer;
})();
