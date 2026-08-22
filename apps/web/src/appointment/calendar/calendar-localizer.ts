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
