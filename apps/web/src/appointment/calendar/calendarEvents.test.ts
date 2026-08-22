import { beforeEach, describe, expect, it } from 'vitest';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import {
  cardLines,
  compactLine,
  defaultScrollOpening,
  displayBounds,
  gridDateAt,
  gridWindow,
  isReleased,
  outsideDisplayCount,
  scrollToHour,
} from './calendar-events';
import { setClinicTimeZone } from '../../clinical/clinicTime';
import { AppointmentStatus } from '@kuwick/shared';

dayjs.extend(utc);
dayjs.extend(timezone);
beforeEach(() => setClinicTimeZone('Asia/Kuala_Lumpur'));

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

describe('the grid opens where the work is — scroll only, roster never (RC blocker)', () => {
  it("6. the clinic's today scrolls to an hour before the clinic's now", () => {
    expect(
      scrollToHour({ anchorKey: '2026-08-19', nowKey: '2026-08-19', nowHour: 14, openingHour: 8 }),
    ).toBe(13);
  });

  it('7. another day with appointments opens at its first appointment', () => {
    expect(
      scrollToHour({
        anchorKey: '2026-08-24',
        nowKey: '2026-08-19',
        nowHour: 14,
        earliestEventHour: 10,
        openingHour: 8,
      }),
    ).toBe(9);
  });

  it('8. an empty other day opens at the BRANCH opening hour — the roster is not an input at all', () => {
    // The signature admits no shifts: provider rosters affect availability
    // only, and this pin is the type-level guarantee outliving any refactor.
    expect(
      scrollToHour({ anchorKey: '2026-08-24', nowKey: '2026-08-19', nowHour: 14, openingHour: 9 }),
    ).toBe(9);
  });

  it('9. the opening hour comes from the branch: display open, else first session, else 08:00', () => {
    const base = {
      calendarDisplayMode: 'STANDARD_HOURS' as const,
      displayOpenTime: null,
      displayCloseTime: null,
      displayPaddingMinutes: 60,
    };
    expect(defaultScrollOpening({ ...base, displayOpenTime: '09:00' })).toBe(9);
    expect(defaultScrollOpening({ ...base, firstSessionTime: '10:30' })).toBe(10);
    expect(defaultScrollOpening(base)).toBe(8);
    // A 24-hour branch must NOT open on midnight's empty hours.
    expect(
      defaultScrollOpening({ ...base, calendarDisplayMode: 'TWENTY_FOUR_HOURS' }),
    ).toBe(8);
    expect(
      defaultScrollOpening({
        ...base,
        calendarDisplayMode: 'TWENTY_FOUR_HOURS',
        firstSessionTime: '07:00',
      }),
    ).toBe(7);
  });
});

describe('RC blocker — the grid window is anchored to ONE calendar date', () => {
  it("10. min, max and the grid date all share the key's calendar date, seconds zeroed", () => {
    const { date, min, max } = gridWindow('2026-08-26', { startHour: 7, endHour: 21 });
    for (const value of [date, min, max]) {
      expect([value.getFullYear(), value.getMonth(), value.getDate()]).toEqual([2026, 7, 26]);
      expect(value.getSeconds()).toBe(0);
      expect(value.getMilliseconds()).toBe(0);
    }
    expect([min.getHours(), min.getMinutes()]).toEqual([7, 0]);
    expect([max.getHours(), max.getMinutes()]).toEqual([20, 59]);
    // 23:00 on the previous date followed by 12:59 on the selected one is the
    // wrapped diary; same-date min<max makes it impossible.
    expect(min.getTime()).toBeLessThan(max.getTime());
  });

  it('11. a 24-hour branch spans 00:00 → 23:59 of the SELECTED date — never into the next one', () => {
    const { min, max } = gridWindow('2026-08-26', { startHour: 0, endHour: 24 });
    expect([min.getHours(), min.getMinutes(), min.getDate()]).toEqual([0, 0, 26]);
    expect([max.getHours(), max.getMinutes(), max.getDate()]).toEqual([23, 59, 26]);
  });

  it("12. gridDateAt never leaves the key's date, whatever hour it is asked for", () => {
    expect(gridDateAt('2026-08-26', 23).getDate()).toBe(26);
    expect(gridDateAt('2026-08-26', 0).getDate()).toBe(26);
    expect(gridDateAt('2026-08-01', 12).getMonth()).toBe(7);
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
