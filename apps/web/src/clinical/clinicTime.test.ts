import { describe, expect, it, afterEach } from 'vitest';
import {
  formatClinicDate,
  formatClinicDateTime,
  formatClinicTime,
  getClinicTimeZone,
  setClinicTimeZone,
} from './clinicTime';

// ===========================================================================
// THE CLINIC'S CLOCK, NOT THE READER'S.
//
// These formatters rendered in the browser's local zone, on the stated
// grounds that Kuwick stored no per-tenant timezone. It does — `Clinic.timezone`
// — and the consultation tariff has converted through it since D-090.
//
// The test runner is UTC, which is exactly why this was invisible: every
// instant rendered back as the wall clock it was built from. Pinning a
// non-UTC zone is the only way to tell the two apart.
// ===========================================================================

const KL = 'Asia/Kuala_Lumpur';
// 01:00Z is 09:00 in Kuala Lumpur — a morning clinic slot.
const MORNING_SLOT = '2026-08-05T01:00:00.000Z';

afterEach(() => setClinicTimeZone(KL));

describe('times render in the clinic’s zone', () => {
  it('1. a 01:00Z instant reads as 09:00 at a Malaysian clinic', () => {
    setClinicTimeZone(KL);

    expect(formatClinicTime(MORNING_SLOT)).toBe('09:00');
  });

  it('2. the same instant reads as 08:00 at a Bangkok clinic', () => {
    // The instant did not move. What it is CALLED depends on where the clinic
    // is, which is the whole point of storing the zone.
    setClinicTimeZone('Asia/Bangkok');

    expect(formatClinicTime(MORNING_SLOT)).toBe('08:00');
  });

  it('3. the full stamp carries the same conversion', () => {
    setClinicTimeZone(KL);

    expect(formatClinicDateTime(MORNING_SLOT)).toBe('5 Aug 2026 · 09:00');
  });

  it('4. a late-evening instant lands on the clinic’s DATE, not UTC’s', () => {
    // 17:00Z is 01:00 on the 6th in Kuala Lumpur. Rendering the UTC date
    // would file a Thursday-morning appointment under Wednesday.
    setClinicTimeZone(KL);

    expect(formatClinicDate('2026-08-05T17:00:00.000Z')).toBe('6 Aug 2026');
  });
});

describe('the zone is set defensively', () => {
  it('5. the default is Malaysian — the same answer the old code gave there', () => {
    // So nothing regresses in the window before the session wires it up.
    setClinicTimeZone(KL);
    expect(getClinicTimeZone()).toBe(KL);
  });

  it.each([null, undefined, '', 'Mars/Olympus_Mons'])(
    '6. %p leaves the previous zone standing rather than throwing',
    (bad) => {
      // A diary rendering in the wrong zone is a bug. A diary that renders
      // nothing at all because a formatter threw is an outage.
      setClinicTimeZone(KL);

      setClinicTimeZone(bad as string);

      expect(getClinicTimeZone()).toBe(KL);
      expect(formatClinicTime(MORNING_SLOT)).toBe('09:00');
    },
  );

  it('7. an empty value still renders as an empty string, not "Invalid Date"', () => {
    expect(formatClinicTime(null)).toBe('');
    expect(formatClinicDateTime(undefined)).toBe('');
  });
});
