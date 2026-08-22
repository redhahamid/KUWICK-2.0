import { LIMITED_THRESHOLD, mapWithConcurrency, summariseAvailabilityDay } from './availability-summary';

// ===========================================================================
// FINAL-UAT — the booking calendar's day language. The engine answers each
// day; this classifier only words the answer, and these pins hold the wording
// still: green means room, amber means little room, grey means none, and a
// closed day is closed rather than "full".
// ===========================================================================

describe('the per-day availability words', () => {
  it('1. plenty of slots is AVAILABLE; at or under the threshold is LIMITED', () => {
    expect(summariseAvailabilityDay({ slotCount: LIMITED_THRESHOLD + 1, reason: null, isPast: false })).toBe('AVAILABLE');
    expect(summariseAvailabilityDay({ slotCount: LIMITED_THRESHOLD, reason: null, isPast: false })).toBe('LIMITED');
    expect(summariseAvailabilityDay({ slotCount: 1, reason: null, isPast: false })).toBe('LIMITED');
  });

  it('2. an empty day is FULL for every operational reason — a patient does not care which', () => {
    for (const reason of ['FULLY_BOOKED', 'NOT_ROSTERED', 'ON_LEAVE', 'TOO_LATE_TO_BOOK'] as const) {
      expect(summariseAvailabilityDay({ slotCount: 0, reason, isPast: false })).toBe('FULL');
    }
  });

  it('3. a closed day says CLOSED, not full — the clinic chose that day off', () => {
    expect(summariseAvailabilityDay({ slotCount: 0, reason: 'CLINIC_CLOSED', isPast: false })).toBe('CLOSED');
    expect(summariseAvailabilityDay({ slotCount: 0, reason: 'PUBLIC_HOLIDAY', isPast: false })).toBe('CLOSED');
  });

  it('4. beyond the booking horizon is OUTSIDE — not offered is not the same as filled up', () => {
    expect(summariseAvailabilityDay({ slotCount: 0, reason: 'TOO_FAR_AHEAD', isPast: false })).toBe('OUTSIDE');
    expect(summariseAvailabilityDay({ slotCount: 0, reason: 'OUTSIDE_BOOKING_WINDOW', isPast: false })).toBe('OUTSIDE');
  });

  it('5. yesterday is PAST whatever else is true of it', () => {
    expect(summariseAvailabilityDay({ slotCount: 10, reason: null, isPast: true })).toBe('PAST');
  });
});

describe('the concurrency pool', () => {
  it('6. preserves order and never runs more than the limit at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 12 }, (_, index) => index);
    const results = await mapWithConcurrency(items, 3, async (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return item * 2;
    });
    expect(results).toEqual(items.map((item) => item * 2));
    expect(peak).toBeLessThanOrEqual(3);
  });
});
