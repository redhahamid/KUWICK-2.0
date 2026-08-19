import { Dayjs } from 'dayjs';
import { AppointmentStatus } from '@kuwick/shared';
import { RELEASED_STATUSES } from '../appointment-status.constants';
import { clinicDayjs } from '../../clinical/clinicTime';
import type { RangeShift } from '../hooks/useRoster';

/**
 * PURE HELPERS FOR THE CALENDAR.
 *
 * Kept out of the component because every one of them is a rule somebody will
 * want to check: which appointments count as occupying a slot, how a card is
 * worded when there is room for four lines and when there is room for one, and
 * where the grid should scroll to on open.
 */

export interface CalendarAppointment {
  id: string;
  staffId: string;
  serviceId: string;
  patientId: string;
  status: AppointmentStatus;
  scheduledStart: string;
  scheduledEnd: string;
}

/** A cancelled or no-show booking is drawn faded, never hidden. */
export function isReleased(status: AppointmentStatus): boolean {
  return RELEASED_STATUSES.includes(status);
}

export interface CardLabelInput {
  time: string;
  patientName: string;
  serviceName: string;
  providerName: string;
}

/**
 * WHAT FITS ON THE CARD, given how tall it is.
 *
 * A 15-minute appointment in a day grid is about twenty pixels. Rendering
 * four lines into it produces four clipped lines, which is worse than one
 * readable one — so the card asks for the level of detail the space allows and
 * the rest lives in the drawer.
 */
export function cardLines(input: CardLabelInput, minutes: number): string[] {
  // The time leads EVERY size — the grid's own 12-hour range label is hidden
  // (index.css) so this line is the chip's only clock, in the clinic format
  // everything else on the page already speaks.
  if (minutes <= 15) return [`${input.time} ${input.patientName}`];
  if (minutes <= 30) return [`${input.time} ${input.patientName}`, input.serviceName];
  return [`${input.time} ${input.patientName}`, input.serviceName, input.providerName];
}

/**
 * WHERE THE GRID OPENS.
 *
 * A 24-hour clinic's day starts at midnight, and a grid that opens at midnight
 * shows the quietest eight hours of the shift. Opening at "now" is right when
 * today is on screen and wrong when it is not — nobody looking at next Tuesday
 * wants it scrolled to 14:37 — so the rule is: today scrolls to an hour before
 * now; any other day scrolls to the earliest rostered start, and failing that
 * to 08:00.
 */
export function scrollToHour(params: {
  anchor: Dayjs;
  now: Dayjs;
  earliestRosteredHour: number | null;
}): number {
  if (params.anchor.isSame(params.now, 'day')) {
    return Math.max(0, params.now.hour() - 1);
  }
  return params.earliestRosteredHour ?? 8;
}

/** The earliest clinic-local hour anybody is rostered in the visible range. */
export function earliestRosteredHour(shifts: RangeShift[] | undefined): number | null {
  if (!shifts?.length) return null;
  const hours = shifts
    .filter((shift) => shift.shiftType === 'WORKING' || shift.shiftType === 'LOCUM')
    .map((shift) => clinicDayjs(shift.startsAt).hour());
  return hours.length > 0 ? Math.min(...hours) : null;
}

/**
 * The hours the grid renders at all.
 *
 * A clinic rostered 23:00-09:00 needs the whole 24 hours; a 9-to-5 clinic
 * showing all 24 wastes two thirds of the screen on hours nobody works. So the
 * bounds follow the ROSTER, padded by an hour either side, and fall back to a
 * sensible working day when there is no roster to read.
 */
export function gridBounds(shifts: RangeShift[] | undefined): { startHour: number; endHour: number } {
  const working = (shifts ?? []).filter(
    (shift) => shift.shiftType === 'WORKING' || shift.shiftType === 'LOCUM',
  );
  if (working.length === 0) return { startHour: 7, endHour: 21 };

  let earliest = 24;
  let latest = 0;
  let crossesMidnight = false;
  for (const shift of working) {
    const start = clinicDayjs(shift.startsAt);
    const end = clinicDayjs(shift.endsAt);
    earliest = Math.min(earliest, start.hour());
    // An end at exactly 17:00 needs the 17th hour drawn to show the line.
    const endHour = end.hour() + (end.minute() > 0 ? 1 : 0);
    latest = Math.max(latest, endHour);
    if (!end.isSame(start, 'day')) crossesMidnight = true;
  }
  // A shift that runs into tomorrow means somebody works every hour between —
  // the grid has to show all of them or the night half is invisible.
  if (crossesMidnight) return { startHour: 0, endHour: 24 };
  return {
    startHour: Math.max(0, earliest - 1),
    endHour: Math.min(24, Math.max(latest + 1, earliest + 2)),
  };
}
