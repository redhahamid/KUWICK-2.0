import { describe, expect, it } from 'vitest';
import dayjs from 'dayjs';
import { getCalendarRange, shiftAnchor } from './calendar-range';

describe('getCalendarRange', () => {
  const anchor = dayjs('2026-08-05T10:00:00.000Z');

  it('day view covers just the anchor date, midnight to midnight', () => {
    const { start, end } = getCalendarRange('day', anchor);
    expect(start.isSame(anchor, 'day')).toBe(true);
    expect(end.isSame(anchor, 'day')).toBe(true);
    expect(start.hour()).toBe(0);
    expect(end.hour()).toBe(23);
  });

  it('provider view covers the same single day as day view', () => {
    const dayRange = getCalendarRange('day', anchor);
    const providerRange = getCalendarRange('provider', anchor);
    expect(providerRange.start.isSame(dayRange.start)).toBe(true);
    expect(providerRange.end.isSame(dayRange.end)).toBe(true);
  });

  it('week view runs Sunday through Saturday and contains the anchor', () => {
    const { start, end } = getCalendarRange('week', anchor);
    expect(start.day()).toBe(0);
    expect(end.day()).toBe(6);
    expect(start.isAfter(anchor, 'day')).toBe(false);
    expect(end.isBefore(anchor, 'day')).toBe(false);
  });

  it('month view covers the whole calendar month', () => {
    const { start, end } = getCalendarRange('month', anchor);
    expect(start.date()).toBe(1);
    expect(start.month()).toBe(anchor.month());
    expect(end.month()).toBe(anchor.month());
    expect(end.date()).toBe(anchor.endOf('month').date());
  });
});

describe('shiftAnchor', () => {
  const anchor = dayjs('2026-08-05T10:00:00.000Z');

  it('day/provider view shifts by one day', () => {
    expect(shiftAnchor('day', anchor, 1).isSame(anchor.add(1, 'day'), 'day')).toBe(true);
    expect(shiftAnchor('provider', anchor, -1).isSame(anchor.subtract(1, 'day'), 'day')).toBe(true);
  });

  it('week view shifts by seven days', () => {
    expect(shiftAnchor('week', anchor, 1).isSame(anchor.add(1, 'week'), 'day')).toBe(true);
  });

  it('month view shifts by one calendar month', () => {
    expect(shiftAnchor('month', anchor, 1).isSame(anchor.add(1, 'month'), 'day')).toBe(true);
  });
});
