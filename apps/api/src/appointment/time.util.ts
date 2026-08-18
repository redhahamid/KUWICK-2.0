// Prisma's @db.Time columns round-trip as JS Date objects with a fixed
// epoch date and the actual time-of-day in the UTC hour/minute/second
// getters — these helpers convert between that and "HH:MM[:SS]" strings.
export function parseTimeToDate(time: string): Date {
  const normalized = time.length === 5 ? `${time}:00` : time;
  return new Date(`1970-01-01T${normalized}.000Z`);
}

export function parseDateOnly(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

// ===========================================================================
// THE CLINIC'S CLOCK IS NOT THE SERVER'S CLOCK.
//
// A roster row says "09:00". A closed date says "24 December". Neither is an
// instant — they are wall-clock facts about a place, and the place is stored:
// `Clinic.timezone`, defaulting to Asia/Kuala_Lumpur.
//
// This module used to combine the two with `Date.UTC(y, m, d, 9, 0)`, which
// produces the instant 09:00Z — 5pm in Kuala Lumpur. Every test and every CI
// run passes because those machines run in UTC, so the wrong instant renders
// back as the right wall clock. On a clinic laptop in Malaysia the whole diary
// reads eight hours late.
//
// The convention, stated once and enforced everywhere below:
//
//   STORED  — `Appointment.scheduledStart/End` are REAL UTC INSTANTS.
//   MATCHED — roster/exception/closed-date comparisons happen in the CLINIC's
//             wall clock, converted through `Clinic.timezone`.
//   RENDERED — the clinic's wall clock, never the reader's. A receptionist on
//             holiday in Perth must not see the diary shift by an hour.
//
// It is the same conversion the consultation tariff already does for visit
// timestamps (`localMinutesOfDay` / `localDateKey`) — deliberately, so the
// clinic has ONE answer to "what time was that" rather than one per module.
// ===========================================================================

/**
 * How far the named zone's wall clock sits ahead of UTC at a given instant.
 *
 * Read from `Intl` rather than a table: the zone database moves, Malaysia has
 * changed its offset before, and a clinic in a DST zone would otherwise be
 * wrong for half the year.
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const at = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');
  // `hour12: false` renders midnight as 24 in some ICU versions.
  const asIfUtc = Date.UTC(at('year'), at('month') - 1, at('day'), at('hour') % 24, at('minute'), at('second'));
  return asIfUtc - instant.getTime();
}

/**
 * A wall-clock reading in the clinic's zone → the instant it names.
 *
 * Two passes. The first guess uses the offset at the WRONG instant (the
 * wall-clock numbers read as UTC), which is off by a whole offset; the second
 * re-reads the offset at the corrected instant. That only matters within an
 * hour of a DST transition, and Malaysia has none — but a clinic is not the
 * only thing this will ever run for, and being right by construction costs one
 * extra `Intl` call a slot-grid.
 */
export function zonedWallClockToInstant(
  wall: { year: number; month: number; day: number; hour: number; minute: number; second?: number },
  timeZone: string,
): Date {
  const asIfUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second ?? 0);
  const firstPass = asIfUtc - zoneOffsetMs(new Date(asIfUtc), timeZone);
  return new Date(asIfUtc - zoneOffsetMs(new Date(firstPass), timeZone));
}

/** The wall clock the clinic reads at a given instant. */
export function instantToZonedWallClock(
  instant: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const shifted = new Date(instant.getTime() + zoneOffsetMs(instant, timeZone));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

/**
 * A calendar date (stored as UTC midnight, a date-only column) plus a
 * time-of-day (a @db.Time column) → the instant the clinic means by it.
 */
export function combineInClinicZone(date: Date, time: Date, timeZone: string): Date {
  return zonedWallClockToInstant(
    {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: time.getUTCHours(),
      minute: time.getUTCMinutes(),
      second: time.getUTCSeconds(),
    },
    timeZone,
  );
}

/** `YYYY-MM-DD` as the clinic reads it — the key closed dates and rosters use. */
export function clinicDateKey(instant: Date, timeZone: string): string {
  const wall = instantToZonedWallClock(instant, timeZone);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${wall.year}-${pad(wall.month)}-${pad(wall.day)}`;
}

/** Minutes since the clinic's midnight — how a booking window is compared. */
export function clinicMinutesOfDay(instant: Date, timeZone: string): number {
  const wall = instantToZonedWallClock(instant, timeZone);
  return wall.hour * 60 + wall.minute;
}

/** Minutes since midnight for a @db.Time column. */
export function timeToMinutesOfDay(time: Date): number {
  return time.getUTCHours() * 60 + time.getUTCMinutes();
}

/**
 * The UTC instants bounding a clinic-local calendar day.
 *
 * A Malaysian 20 August runs from 19 Aug 16:00Z to 20 Aug 16:00Z. Querying
 * `scheduledStart` between UTC midnights would miss the evening clinic and
 * pick up the previous one.
 */
export function clinicDayBounds(date: Date, timeZone: string): { start: Date; end: Date } {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  return {
    start: zonedWallClockToInstant({ year, month, day, hour: 0, minute: 0 }, timeZone),
    end: zonedWallClockToInstant({ year, month, day: day + 1, hour: 0, minute: 0 }, timeZone),
  };
}
