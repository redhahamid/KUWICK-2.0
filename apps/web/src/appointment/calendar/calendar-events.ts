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
  /** "09:00 – 10:00" — shown instead of the bare start on EXPANDED cards. */
  timeRange?: string;
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
/**
 * THE NARROW-COLUMN LINE. A week column on a laptop is ~150px; three lines of
 * clipped text ("09:00 Ta…", "Exe…") read as noise, not information. When
 * space is short the card carries the two facts a receptionist scans for —
 * time and who.
 *
 * Phase 3F — the WHOLE name, not just the first. The patient's name is the
 * card's primary anchor ("10:30 Afiq Jonas"), and two patients called Siti on
 * the same morning were indistinguishable under first-name-only. When the
 * column genuinely cannot hold it, the stylesheet's container query trims with
 * an ellipsis — a display concern, decided by real width rather than guessed
 * here.
 */
export function compactLine(time: string, patientName: string): string {
  return `${time} ${patientName.trim()}`;
}

/**
 * V3 — the STRUCTURED card, same density ladder as `cardLines` but with the
 * parts kept apart so the card can weight them differently (time bold in ink,
 * patient heavier than service, provider muted). `cardLines` stays as the
 * single-string form the tooltip uses.
 */
export interface CardModel {
  /** "09:00" or, on EXPANDED cards, "09:00 – 10:00". */
  time: string;
  /** The patient's full name at every tier — the card's visual anchor (3F). */
  patient: string;
  service?: string;
  provider?: string;
  /** ≤15 minutes: about 22px of card — ONE line (dot · time · name). */
  compact?: boolean;
  /**
   * ≤30 minutes: ~44px holds exactly two lines, so time and name share the
   * first ("● 09:00 Tan Mei Chen") and the service takes the second. Three
   * stacked lines here clip mid-glyph.
   */
  dense?: boolean;
}

export function cardModel(input: CardLabelInput, minutes: number): CardModel {
  // The tiers are measured against the grid, not aspiration: a 30-minute slot
  // is ~44px tall, which holds exactly two lines — a third clips mid-glyph,
  // and a clipped line is worse than a line the drawer carries instead.
  //
  // Phase 3F ladder — VERY SHORT "10:30 Afiq Jonas"; MEDIUM adds the service;
  // LARGE has room for the full range and the provider. The patient's full
  // name anchors every tier; ellipsis is the stylesheet's call, not this one's.
  if (minutes <= 15) {
    return {
      time: input.time,
      patient: input.patientName.trim(),
      compact: true,
    };
  }
  if (minutes <= 30) {
    return { time: input.time, patient: input.patientName, service: input.serviceName, dense: true };
  }
  if (minutes <= 45) {
    return { time: input.time, patient: input.patientName, service: input.serviceName };
  }
  return {
    time: input.timeRange ?? input.time,
    patient: input.patientName,
    service: input.serviceName,
    provider: input.providerName,
  };
}

/**
 * V3 — the status DOT on a calendar card.
 *
 * The provider is the card's left edge; the status is this dot (and the word
 * in the drawer — colour never carries meaning alone, the dot is a preview of
 * the chip, not a replacement for it). Mid-saturation hues, one per D-105
 * tone, chosen to read at 7px.
 */
export function statusDotColor(status: AppointmentStatus): string {
  switch (status) {
    case AppointmentStatus.REQUESTED:
      return '#7f56d9'; // planned
    case AppointmentStatus.ARRIVED:
      return '#d97706'; // attention — physically at the desk
    case AppointmentStatus.CHECKED_IN:
    case AppointmentStatus.IN_QUEUE:
      return '#0f6b78'; // clinical — in the building
    case AppointmentStatus.COMPLETED:
      return '#16a34a'; // success
    case AppointmentStatus.CANCELLED:
    case AppointmentStatus.NO_SHOW:
    case AppointmentStatus.RESCHEDULED:
    case AppointmentStatus.WAITLIST:
      return '#98a2b3'; // released
    default:
      return '#1d4ed8'; // active — confirmed and coming
  }
}

/** The soft card tint a status earns; white when it has nothing to say. */
export function statusCardBackground(status: AppointmentStatus): string {
  switch (status) {
    case AppointmentStatus.ARRIVED:
      return '#fff8eb';
    case AppointmentStatus.CHECKED_IN:
    case AppointmentStatus.IN_QUEUE:
      return '#eff8f8';
    case AppointmentStatus.REQUESTED:
      return '#faf7ff';
    case AppointmentStatus.COMPLETED:
      return '#f8fafc';
    default:
      return '#ffffff';
  }
}

export function cardLines(input: CardLabelInput, minutes: number): string[] {
  // The time leads EVERY size — the grid's own 12-hour range label is hidden
  // (index.css) so this line is the chip's only clock, in the clinic format
  // everything else on the page already speaks.
  //
  // Four densities (§14): SHORT is the two facts a receptionist scans for,
  // first name only; STANDARD adds what and who-with; EXPANDED — an hour or
  // more of card — has room for the full range on its own line, which is the
  // one place "how long" matters more than "when does it start".
  if (minutes <= 15) return [compactLine(input.time, input.patientName)];
  if (minutes <= 30) return [`${input.time} ${input.patientName}`, input.serviceName];
  if (minutes <= 45) {
    return [`${input.time} ${input.patientName}`, input.serviceName, input.providerName];
  }
  return [
    input.timeRange ?? input.time,
    input.patientName,
    input.serviceName,
    input.providerName,
  ];
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
  /**
   * V3 — the first APPOINTMENT of the day being looked at, when there is one.
   * On a 24-hour roster `earliestRosteredHour` is 0 (the night shift covers
   * midnight), which opened the day on eight empty hours; the first booking
   * is where the reading starts. Optional so every existing caller and test
   * keeps its meaning.
   */
  earliestEventHour?: number | null;
}): number {
  if (params.anchor.isSame(params.now, 'day')) {
    return Math.max(0, params.now.hour() - 1);
  }
  if (params.earliestEventHour != null) {
    return Math.max(0, params.earliestEventHour - 1);
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
 * PHASE 3 — THE DIARY AXIS IS A BRANCH SETTING, NEVER A ROSTER READING.
 *
 * The roster decides AVAILABILITY. It is not allowed to decide what hours the
 * diary renders: derived from shifts, the axis wrapped on live iPad UAT
 * (23:00 → next-day 13:30 for an overnight roster) and changed shape from one
 * date to the next. These bounds are a pure function of the branch's own
 * calendar-display settings — no shifts, no appointments, no date — so the
 * axis cannot move whatever is rostered, filtered or selected.
 */
export interface CalendarDisplayPrefs {
  calendarDisplayMode: 'STANDARD_HOURS' | 'TWENTY_FOUR_HOURS';
  /** "HH:MM" wall clock, or null when the branch never stated its hours. */
  displayOpenTime: string | null;
  displayCloseTime: string | null;
  displayPaddingMinutes: number;
}

/** The stable band an unconfigured standard-hours branch shows. */
const DEFAULT_OPEN = '08:00';
const DEFAULT_CLOSE = '20:00';

function hourOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h + m / 60;
}

export function displayBounds(
  prefs: CalendarDisplayPrefs | undefined,
  showFullDay = false,
): { startHour: number; endHour: number } {
  // A 24-hour branch's day is 00:00→24:00, always and in order — never
  // 23:00 wrapping into tomorrow afternoon. The reveal toggle gives a
  // standard-hours branch the same full day on demand, because an
  // out-of-hours booking must be reachable, not merely believed in.
  if (showFullDay || prefs?.calendarDisplayMode === 'TWENTY_FOUR_HOURS') {
    return { startHour: 0, endHour: 24 };
  }
  const open = hourOf(prefs?.displayOpenTime || DEFAULT_OPEN);
  const close = hourOf(prefs?.displayCloseTime || DEFAULT_CLOSE);
  const padding = (prefs?.displayPaddingMinutes ?? 60) / 60;
  const startHour = Math.max(0, Math.floor(open - padding));
  const endHour = Math.min(24, Math.ceil(close + padding));
  // A nonsense pair (close before open) still renders a usable day rather
  // than a zero-height grid; the server refuses storing one, this is belt.
  if (endHour <= startHour) return { startHour: 0, endHour: 24 };
  return { startHour, endHour };
}

/**
 * The bookings the fixed axis cannot show — counted so the diary can SAY so
 * ("2 outside displayed hours") instead of silently hiding them. Released
 * bookings are ignored: a cancelled 06:00 is not worth widening the day for.
 */
export function outsideDisplayCount(
  events: { start: Date; end: Date; released: boolean }[],
  bounds: { startHour: number; endHour: number },
): number {
  return events.filter((event) => {
    if (event.released) return false;
    const startsBefore =
      event.start.getHours() + event.start.getMinutes() / 60 < bounds.startHour;
    const endMinutes = event.end.getHours() * 60 + event.end.getMinutes();
    // An event ending exactly at the close line is fully visible.
    const endsAfter = (endMinutes === 0 ? 24 * 60 : endMinutes) > bounds.endHour * 60;
    return startsBefore || endsAfter;
  }).length;
}
