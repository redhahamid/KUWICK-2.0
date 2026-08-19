import { beforeEach, describe, expect, it } from 'vitest';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import {
  cardLines,
  earliestRosteredHour,
  gridBounds,
  isReleased,
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
  it('1. a 15-minute slot gets the name and nothing else', () => {
    // Twenty pixels of card. Four lines into it is four clipped lines, which
    // is worse than one readable one.
    expect(
      cardLines(
        { time: '09:00', patientName: 'Ahmad', serviceName: 'Consultation', providerName: 'Dr A' },
        15,
      ),
    ).toEqual(['Ahmad']);
  });

  it('2. half an hour gets the time and the service', () => {
    expect(
      cardLines(
        { time: '09:00', patientName: 'Ahmad', serviceName: 'Consultation', providerName: 'Dr A' },
        30,
      ),
    ).toEqual(['09:00 Ahmad', 'Consultation']);
  });

  it('3. an hour gets the provider too', () => {
    expect(
      cardLines(
        { time: '09:00', patientName: 'Ahmad', serviceName: 'Consultation', providerName: 'Dr A' },
        60,
      ),
    ).toHaveLength(3);
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

describe('the grid shows the hours somebody actually works', () => {
  it('10. a 9-to-5 clinic does not render all twenty-four hours', () => {
    // 01:00Z–09:00Z is 09:00–17:00 KL.
    const bounds = gridBounds([shift('2026-08-19T01:00:00.000Z', '2026-08-19T09:00:00.000Z')]);
    expect(bounds.startHour).toBe(8);
    expect(bounds.endHour).toBe(18);
  });

  it('11. an overnight shift means the WHOLE day is drawn', () => {
    // Somebody works every hour between 23:00 and 09:00 the next morning, and
    // a grid that clipped to 22:00–10:00 would hide the night half entirely.
    const bounds = gridBounds([shift('2026-08-19T15:00:00.000Z', '2026-08-20T01:00:00.000Z')]);
    expect(bounds).toEqual({ startHour: 0, endHour: 24 });
  });

  it('12. no roster falls back to a working day rather than an empty grid', () => {
    expect(gridBounds(undefined)).toEqual({ startHour: 7, endHour: 21 });
    expect(gridBounds([])).toEqual({ startHour: 7, endHour: 21 });
  });

  it('13. an OFF-only day is treated as having no roster', () => {
    const bounds = gridBounds([
      shift('2026-08-19T00:00:00.000Z', '2026-08-19T12:00:00.000Z', 'OFF'),
    ]);
    expect(bounds).toEqual({ startHour: 7, endHour: 21 });
  });

  it('14. a locum counts as somebody working', () => {
    const bounds = gridBounds([
      shift('2026-08-19T01:00:00.000Z', '2026-08-19T09:00:00.000Z', 'LOCUM'),
    ]);
    expect(bounds.startHour).toBe(8);
  });
});
