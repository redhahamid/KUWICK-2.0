import { AppointmentStatus } from '@kuwick/shared';
import { RELEASED_STATUSES } from '../appointment-status.constants';
import { statusAccent, statusSoft } from '../shared/appointment-colors';

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
 * the chip, not a replacement for it). The hexes live in ONE place now —
 * shared/appointment-colors.ts — because four independent copies of "what
 * colour is ARRIVED" had already drifted before the premium pass.
 */
export function statusDotColor(status: AppointmentStatus): string {
  return statusAccent(status);
}

/** The soft card tint a status earns; white when it has nothing to say. */
export function statusCardBackground(status: AppointmentStatus): string {
  return statusSoft(status);
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
 * WHERE THE GRID OPENS — a SCROLL policy, never an axis input (RC blocker).
 *
 * The rule, in the owner's words: today opens near the clinic's own "now";
 * another day with appointments opens at its first appointment; an empty day
 * opens at the branch's opening hour. The ROSTER is not consulted — provider
 * shifts affect availability only, and this function's inputs make that
 * structural: dates arrive as plain YYYY-MM-DD keys and hours as numbers, so
 * no timezone-mode dayjs (the drill-down crash class) can reach it.
 */
export function scrollToHour(params: {
  /** The selected calendar date, as the clinic understands it. */
  anchorKey: string;
  /** The clinic's current date key and hour (from clinicDayjs(now)). */
  nowKey: string;
  nowHour: number;
  /** The first APPOINTMENT of the day being looked at, when there is one. */
  earliestEventHour?: number | null;
  /** The branch's opening hour — see defaultScrollOpening. */
  openingHour: number;
}): number {
  if (params.anchorKey === params.nowKey) {
    return Math.max(0, params.nowHour - 1);
  }
  if (params.earliestEventHour != null) {
    return Math.max(0, params.earliestEventHour - 1);
  }
  return params.openingHour;
}

/**
 * The hour an EMPTY day opens on: the branch's stated opening. A standard
 * branch opens at its display-open hour; a 24-hour branch (whose band top is
 * midnight — the quietest hours of the shift) opens at its booking window's
 * first session, and failing any stated hour at 08:00.
 */
export function defaultScrollOpening(prefs: CalendarDisplayPrefs | undefined): number {
  if (prefs && prefs.calendarDisplayMode !== 'TWENTY_FOUR_HOURS' && prefs.displayOpenTime) {
    return Math.floor(hourOf(prefs.displayOpenTime));
  }
  if (prefs?.firstSessionTime) return Math.floor(hourOf(prefs.firstSessionTime));
  if (prefs && prefs.calendarDisplayMode !== 'TWENTY_FOUR_HOURS') return Math.floor(hourOf(DEFAULT_OPEN));
  return 8;
}

/**
 * RC BLOCKER FIX — THE GRID'S DATES, ANCHORED TO ONE CALENDAR DATE.
 *
 * react-big-calendar is handed three Dates (`date`, `min`, `max`) plus a
 * scroll target, and the whole wrapped-axis defect class is those Dates
 * disagreeing about which calendar date they are on: an anchor that had
 * drifted into a timezone-mode dayjs put `min` on 25 Aug 23:00 and `max` on
 * 26 Aug 12:59 in a UTC browser — a 23:00 → next-afternoon diary, and in
 * rbc's slot arithmetic an "Invalid array length" white-screen.
 *
 * So the grid's Dates are built HERE, from a plain YYYY-MM-DD key and the
 * branch bounds, with local-field construction only. Whatever mode the
 * anchor dayjs is in, `anchor.format('YYYY-MM-DD')` names the same calendar
 * date — and every Date this returns shares it. Seconds are zeroed; the
 * grid `date` sits at noon so no library round-trip can nudge it across
 * midnight.
 */
export function gridWindow(
  dateKey: string,
  bounds: { startHour: number; endHour: number },
): { date: Date; min: Date; max: Date } {
  const lastHour = Math.max(bounds.startHour, Math.min(23, bounds.endHour - 1));
  return {
    date: gridDateAt(dateKey, 12),
    min: gridDateAt(dateKey, bounds.startHour),
    // endHour names the line the day CLOSES on (18 → the diary ends at
    // 18:00), so the last rendered hour block is endHour-1:59.
    max: gridDateAt(dateKey, lastHour, 59),
  };
}

/** A local-field Date on the key's calendar date — never any other. */
export function gridDateAt(dateKey: string, hour: number, minute = 0): Date {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day, Math.floor(hour), minute, 0, 0);
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
  /** The booking window's first session — the empty-day scroll fallback. */
  firstSessionTime?: string | null;
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

/**
 * OVERLAP THAT STAYS READABLE — the owner's blocker, solved as presentation.
 *
 * react-big-calendar divides a column between everything that overlaps, so a
 * 09:00 with six concurrent bookings became six ~25px slivers reading
 * "● 09:0…". The times were right and the data was right; the SCREEN was
 * useless, which is the same as being wrong at a front counter.
 *
 * This caps how many cards may share a band and hands the remainder to a
 * "+N more" tile — exactly the overflow the approved mockup draws in its own
 * week panel. Nothing about the appointments changes: every one keeps its
 * true start and end, the hidden ones are carried ON the tile so one click
 * lists them, and availability, booking and conflict rules never see this
 * function. It is a pure geometry decision about a fixed number of pixels.
 *
 * Clusters are per COLUMN (a day, or a provider's day in the resource view),
 * found by the standard sweep: sorted by start, a booking joins the running
 * cluster while it begins before the cluster's furthest end.
 */
export interface ConcurrencyInput {
  id: string;
  start: Date;
  end: Date;
  resourceId?: string;
}

export interface OverflowBundle<T> {
  /** Stable id so React and rbc can key the synthetic tile. */
  id: string;
  start: Date;
  end: Date;
  resourceId?: string;
  hidden: T[];
}

export function capConcurrency<T extends ConcurrencyInput>(
  events: T[],
  limit: number,
): { visible: T[]; overflow: OverflowBundle<T>[] } {
  if (limit < 1 || events.length === 0) return { visible: events, overflow: [] };

  const columns = new Map<string, T[]>();
  for (const event of events) {
    // One bucket per provider column per calendar date — the two things that
    // actually decide whether two cards must share horizontal space.
    const key = `${event.resourceId ?? ''}|${event.start.getFullYear()}-${event.start.getMonth()}-${event.start.getDate()}`;
    const bucket = columns.get(key);
    if (bucket) bucket.push(event);
    else columns.set(key, [event]);
  }

  const visible: T[] = [];
  const overflow: OverflowBundle<T>[] = [];

  for (const bucket of columns.values()) {
    const sorted = [...bucket].sort((a, b) => a.start.getTime() - b.start.getTime());
    let cluster: T[] = [];
    let clusterEnd = -Infinity;

    const flush = () => {
      if (cluster.length === 0) return;
      if (cluster.length <= limit) {
        visible.push(...cluster);
      } else {
        // Keep the earliest (limit - 1) cards whole; the rest become one tile
        // spanning the band they actually occupy.
        const kept = cluster.slice(0, limit - 1);
        const hidden = cluster.slice(limit - 1);
        visible.push(...kept);
        overflow.push({
          id: `overflow:${hidden[0].id}:${hidden.length}`,
          start: hidden.reduce((min, row) => (row.start < min ? row.start : min), hidden[0].start),
          end: hidden.reduce((max, row) => (row.end > max ? row.end : max), hidden[0].end),
          resourceId: hidden[0].resourceId,
          hidden,
        });
      }
      cluster = [];
      clusterEnd = -Infinity;
    };

    for (const event of sorted) {
      if (cluster.length > 0 && event.start.getTime() >= clusterEnd) flush();
      cluster.push(event);
      clusterEnd = Math.max(clusterEnd, event.end.getTime());
    }
    flush();
  }

  return { visible, overflow };
}
