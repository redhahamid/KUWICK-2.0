import type { UnavailableReason } from './slot-availability.service';

/**
 * FINAL-UAT REDESIGN — the booking calendar's per-day summary language.
 *
 * The premium date picker colour-codes every day of a month (Available /
 * Limited / Full / closed) so a patient never has to tap dates one by one to
 * discover where the room is. The CLASSIFICATION is pure and lives here; the
 * per-day answers it classifies come from the canonical availability engine,
 * one call per day — this module must never grow an opinion about WHY a day
 * is empty, only about how to word the engine's answer.
 */
export type DayStatus = 'AVAILABLE' | 'LIMITED' | 'FULL' | 'CLOSED' | 'OUTSIDE' | 'PAST';

/** At or below this many free slots, a day is "Limited" rather than green. */
export const LIMITED_THRESHOLD = 3;

export interface DaySummaryInput {
  slotCount: number;
  reason: UnavailableReason | null;
  isPast: boolean;
}

export function summariseAvailabilityDay(input: DaySummaryInput): DayStatus {
  if (input.isPast) return 'PAST';
  if (input.slotCount > LIMITED_THRESHOLD) return 'AVAILABLE';
  if (input.slotCount > 0) return 'LIMITED';
  switch (input.reason) {
    case 'CLINIC_CLOSED':
    case 'PUBLIC_HOLIDAY':
      return 'CLOSED';
    case 'TOO_FAR_AHEAD':
    case 'OUTSIDE_BOOKING_WINDOW':
      // Beyond the clinic's booking horizon — not offered, distinct from
      // "was offered and filled up".
      return 'OUTSIDE';
    default:
      // FULLY_BOOKED, NOT_ROSTERED, ON_LEAVE, TOO_LATE_TO_BOOK, … — to a
      // patient these are all one fact: nothing bookable that day.
      return 'FULL';
  }
}

/** Run `fn` over `items` at most `limit` at a time, preserving order. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
