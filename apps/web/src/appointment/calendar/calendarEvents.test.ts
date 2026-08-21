import { beforeEach, describe, expect, it } from 'vitest';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import {
  cardLines,
  compactLine,
  displayBounds,
  earliestRosteredHour,
  isReleased,
  outsideDisplayCount,
  scrollToHour,
} from './calendar-events';
import { setClinicTimeZone, clinicDayjs } from '../../clinical/clinicTime';
import { AppointmentStatus } from '@kuwick/shared';
import type { RangeShift } from '../hooks/useRoster';

dayjs.extend(utc);
dayjs.extend(timezone);
beforeEach(() => setClinicTimeZone('Asia/Kuala_Lumpur'));

const shift = (startsAt: string, endsAt: string, shiftType = 'WORKING'): RangeShift => ({
  id: startsAt,
  staffId: 'doc-1',
  shiftType: shiftType as RangeShift['shiftType'],
  startsAt,
  endsAt,
  bookableStartsAt: null,
  bookableEndsAt: null,
  note: null,
});

describe('a card says as much as it has room for', () => {
  it('1. a 15-minute slot gets one line: the time and the name', () => {
    // Twenty pixels of card. Four lines into it is four clipped lines, which
    // is worse than one readable one — and since the grid's own 12-hour
    // label is hidden, this line carries the chip's only clock.
    expect(
      cardLines(
        { time: '09:00', patientName: 'Ahmad', serviceName: 'Consultation', providerName: 'Dr A' },
        15,
      ),
    ).toEqual(['09:00 Ahmad']);
  });

  it('2. half an hour gets the time and the service', () => {
    expect(
      cardLines(
        { time: '09:00', patientName: 'Ahmad', serviceName: 'Consultation', providerName: 'Dr A' },
        30,
      ),
    ).toEqual(['09:00 Ahmad', 'Consultation']);
  });

  it('3. forty-five minutes gets the provider too', () => {
    expect(
      cardLines(
        { time: '09:00', patientName: 'Ahmad', serviceName: 'Consultation', providerName: 'Dr A' },
        45,
      ),
    ).toHaveLength(3);
  });

  it('3a. the narrow-column line carries the WHOLE name — the patient is the anchor', () => {
    // Phase 3F: "10:30 Afiq Jonas", not "10:30 Afiq". Two patients called
    // Siti on one morning were indistinguishable under first-name-only; when
    // a column truly cannot hold the name, the stylesheet ellipsises it.
    expect(compactLine('10:30', 'Afiq Jonas')).toBe('10:30 Afiq Jonas');
  });

  it('3b. an hour or more is EXPANDED: the full range leads, four lines', () => {
    // The one card size where "how long" matters more than "when it starts".
    expect(
      cardLines(
        {
          time: '09:00',
          timeRange: '09:00 – 10:00',
          patientName: 'Ahmad',
          serviceName: 'Consultation',
          providerName: 'Dr A',
        },
        60,
      ),
    ).toEqual(['09:00 – 10:00', 'Ahmad', 'Consultation', 'Dr A']);
  });
});

describe('a released appointment is drawn, not hidden', () => {
  it.each([
    AppointmentStatus.CANCELLED,
    AppointmentStatus.NO_SHOW,
    AppointmentStatus.WAITLIST,
    AppointmentStatus.RESCHEDULED,
  ])('4. %s no longer occupies its slot', (status) => {
    expect(isReleased(status)).toBe(true);
  });

  it.each([AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN, AppointmentStatus.COMPLETED])(
    '5. %s still does',
    (status) => {
      expect(isReleased(status)).toBe(false);
    },
  );
});

describe('the grid opens where the work is', () => {
  it('6. today scrolls to an hour before now', () => {
    const now = clinicDayjs('2026-08-19T06:00:00.000Z'); // 14:00 KL
    expect(scrollToHour({ anchor: now, now, earliestRosteredHour: 8 })).toBe(13);
  });

  it('7. another day scrolls to the earliest rostered hour', () => {
    // Nobody looking at next Tuesday wants it scrolled to 14:37.
    const now = clinicDayjs('2026-08-19T06:00:00.000Z');
    const anchor = now.add(5, 'day');
    expect(scrollToHour({ anchor, now, earliestRosteredHour: 7 })).toBe(7);
  });

  it('8. with no roster at all it opens at 08:00 rather than midnight', () => {
    const now = clinicDayjs('2026-08-19T06:00:00.000Z');
    expect(scrollToHour({ anchor: now.add(5, 'day'), now, earliestRosteredHour: null })).toBe(8);
  });

  it('9. the earliest rostered hour ignores OFF and LEAVE rows', () => {
    const shifts = [
      shift('2026-08-19T00:00:00.000Z', '2026-08-19T12:00:00.000Z', 'OFF'),
      shift('2026-08-19T01:00:00.000Z', '2026-08-19T09:00:00.000Z'),
    ];
    // 01:00Z is 09:00 KL.
    expect(earliestRosteredHour(shifts)).toBe(9);
  });
});

describe('Phase 3 — the diary axis is a branch setting, never a roster reading', () => {
  const standard = (open: string | null, close: string | null, padding = 60) => ({
    calendarDisplayMode: 'STANDARD_HOURS' as const,
    displayOpenTime: open,
    displayCloseTime: close,
    displayPaddingMinutes: padding,
  });

  it('10. a 24-hour branch renders 00:00→24:00, chronologically, always', () => {
    // The live-UAT defect: an overnight roster made the axis read
    // 23:00 → … → next-day 13:30. A 24-hour branch's day is midnight to
    // midnight whatever anybody's shift says.
    expect(
      displayBounds({ ...standard(null, null), calendarDisplayMode: 'TWENTY_FOUR_HOURS' }),
    ).toEqual({ startHour: 0, endHour: 24 });
  });

  it('11. the axis is a pure function of the branch settings — no roster, no date, no filter input exists', () => {
    // The whole class of wrap/jump defects is closed structurally: shifts,
    // selected dates and filters cannot redefine bounds because the function
    // cannot be handed them. Same settings, same axis, every call.
    const first = displayBounds(standard('09:00', '17:00'));
    const second = displayBounds(standard('09:00', '17:00'));
    expect(first).toEqual(second);
    expect(displayBounds.length).toBeLessThanOrEqual(2); // prefs + reveal, nothing else
  });

  it('12. a 09:00–17:00 branch shows a padded 08:00–18:00 diary', () => {
    expect(displayBounds(standard('09:00', '17:00', 60))).toEqual({ startHour: 8, endHour: 18 });
  });

  it('13. a branch that never stated its hours gets a stable default band', () => {
    // Not the roster, not 24 empty hours: the same 07:00–21:00 every day
    // until somebody states the branch's hours in Calendar display settings.
    expect(displayBounds(undefined)).toEqual({ startHour: 7, endHour: 21 });
    expect(displayBounds(standard(null, null))).toEqual({ startHour: 7, endHour: 21 });
  });

  it('14. "show full 24 hours" widens a standard-hours diary on demand', () => {
    expect(displayBounds(standard('09:00', '17:00'), true)).toEqual({ startHour: 0, endHour: 24 });
  });

  it('15. padding never pushes the axis past midnight in either direction', () => {
    expect(displayBounds(standard('00:30', '23:30', 120))).toEqual({ startHour: 0, endHour: 24 });
  });

  it('16. bookings outside the displayed band are counted, so the diary can say so', () => {
    const bounds = { startHour: 8, endHour: 18 };
    const at = (h: number, m = 0, durationMinutes = 30, released = false) => {
      const start = new Date(2026, 7, 19, h, m);
      return {
        start,
        end: new Date(start.getTime() + durationMinutes * 60000),
        released,
      };
    };
    // 06:00 is before the band; 17:30–18:00 ends exactly on the close line and
    // is fully visible; a released 05:00 is nobody's reason to widen the day.
    expect(
      outsideDisplayCount([at(6), at(10), at(17, 30), at(5, 0, 30, true)], bounds),
    ).toBe(1);
    // 17:45–18:15 spills past the close line.
    expect(outsideDisplayCount([at(17, 45)], bounds)).toBe(1);
  });
});
