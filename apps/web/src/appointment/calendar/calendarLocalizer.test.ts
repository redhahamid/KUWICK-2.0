import { describe, expect, it } from 'vitest';
import dayjs from 'dayjs';
// The app composition: clinicTime extends the shared dayjs with utc+timezone
// at import time, exactly as every real page does.
import '../../clinical/clinicTime';
import { calendarLocalizer, localizerDayjs } from './calendar-localizer';

// ===========================================================================
// RC BLOCKER — THE LOCALIZER MUST NEVER SEE `dayjs.tz`.
//
// react-big-calendar's dayjsLocalizer switches every primitive onto
// `dayjs.tz` the moment the timezone plugin exists on the instance it is
// given, and its tz `merge()` round-trips through a string parsed AS UTC:
// on a Malaysian browser, merge(26 Aug 07:00) returned 25 Aug 23:00 — the
// previous calendar date, minus the UTC offset — which rendered the wrapped
// 11:00 PM → 12:00 AM → … diary on every view. A UTC machine shifts by
// zero, which is exactly why UTC-based CI could not see it. These pins are
// the guard: the facade stays tz-free, the app's dayjs keeps its plugins,
// and merge is local-field arithmetic on the DATE argument's calendar date.
// ===========================================================================

describe('the calendar localizer runs on plain local fields', () => {
  it('1. the facade has NO .tz — rbc takes its local-field branch in every zone', () => {
    expect((localizerDayjs as { tz?: unknown }).tz).toBeUndefined();
  });

  it('2. the app’s own dayjs KEEPS the timezone plugin — clinic conversions are untouched', () => {
    expect((dayjs as unknown as { tz?: unknown }).tz).toBeDefined();
  });

  it('2b. plugins the localizer installs LATER are visible through the facade', () => {
    // dayjsLocalizer extends minMax onto the real dayjs during construction
    // and then calls dayjsLib.max(...). A snapshot facade missed them and
    // white-screened the grid ("e.max is not a function") — the facade must
    // be a live delegate.
    expect((localizerDayjs as unknown as { max?: unknown }).max).toBeTypeOf('function');
    expect((localizerDayjs as unknown as { min?: unknown }).min).toBeTypeOf('function');
  });

  it('3. merge() keeps the date argument’s calendar date, whatever zone this test host is in', () => {
    const date = new Date(2026, 7, 26, 7, 0, 0, 0);
    const time = new Date(2026, 7, 26, 7, 0, 0, 0);
    const merged = calendarLocalizer.merge(date, time) as Date;
    // The defect was 25 Aug 23:00 here. Same date, same wall time — always.
    expect([merged.getFullYear(), merged.getMonth(), merged.getDate()]).toEqual([2026, 7, 26]);
    expect([merged.getHours(), merged.getMinutes()]).toEqual([7, 0]);
  });

  it('4. merge() combines a day with a different wall time without leaving the day', () => {
    const day = new Date(2026, 7, 29, 0, 0, 0, 0);
    const time = new Date(2026, 7, 26, 20, 59, 0, 0);
    const merged = calendarLocalizer.merge(day, time) as Date;
    expect(merged.getDate()).toBe(29);
    expect([merged.getHours(), merged.getMinutes()]).toEqual([20, 59]);
  });

  it('5. startOf("day") stays on the same calendar date at midnight local', () => {
    const start = calendarLocalizer.startOf(new Date(2026, 7, 26, 7, 0), 'day') as Date;
    expect([start.getDate(), start.getHours()]).toEqual([26, 0]);
  });
});
