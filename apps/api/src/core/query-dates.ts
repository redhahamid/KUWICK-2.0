import { BadRequestException } from '@nestjs/common';

/**
 * DATE QUERY PARAMETERS, PARSED HONESTLY.
 *
 * Every admin report is scoped by a date or a date range, and those arrive as
 * raw query strings. Before this existed each service did its own
 * `new Date(`${from}T00:00:00.000Z`)`, which has two failure modes and no
 * error message for either: a MISSING parameter becomes the string
 * "undefinedT00:00:00.000Z", and a malformed one ("2026-13-40", "last-week")
 * becomes an Invalid Date. Both then travel into Prisma or into
 * `getUTCFullYear()` and surface to the client as a bare 500 "Internal server
 * error" — a message that tells a person nothing and an integrator less.
 *
 * A missing or unparseable date is the CALLER's mistake, so it is a 400 that
 * names the parameter. Parsing lives here rather than in a DTO because these
 * are query strings on GET endpoints, several of which existed before the
 * admin work and are called by clients this branch does not control.
 *
 * Everything is UTC midnight. The clinic's business day is a calendar date,
 * not an instant, and a report that silently shifts by the server's timezone
 * is a report two people read differently.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Parses `YYYY-MM-DD` to UTC midnight, or explains why it could not. */
export function parseDateParam(value: string | undefined, name: string): Date {
  if (value === undefined || value === null || value === '') {
    throw new BadRequestException(`${name} is required (YYYY-MM-DD)`);
  }
  const trimmed = value.slice(0, 10);
  if (!ISO_DATE.test(trimmed)) {
    throw new BadRequestException(`${name} must be a date in YYYY-MM-DD form, received "${value}"`);
  }
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${name} is not a real date: "${value}"`);
  }
  // `new Date('2026-02-31')` does not throw — it rolls forward to March 3rd.
  // A report silently run for the wrong day is worse than one that refuses.
  if (parsed.toISOString().slice(0, 10) !== trimmed) {
    throw new BadRequestException(`${name} is not a real date: "${value}"`);
  }
  return parsed;
}

/** The same, but `undefined` stays `undefined` — for genuinely optional filters. */
export function parseOptionalDateParam(value: string | undefined, name: string): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return parseDateParam(value, name);
}

/**
 * A from/to pair, with the ordering checked. An inverted range returns an
 * empty report rather than an error, which reads as "there was no business
 * that week" — the one wrong answer a finance screen must never give.
 */
export function parseDateRangeParams(
  from: string | undefined,
  to: string | undefined,
  names: { from: string; to: string } = { from: 'from', to: 'to' },
): { from: Date; to: Date } {
  const start = parseDateParam(from, names.from);
  const end = parseDateParam(to, names.to);
  if (end.getTime() < start.getTime()) {
    throw new BadRequestException(`${names.to} (${to}) is before ${names.from} (${from})`);
  }
  return { from: start, to: end };
}

/** `YYYY-MM-DD` for a Date, in UTC. The inverse of parseDateParam. */
export function toDateParam(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Cross-checks a from/to PAIR, which a per-parameter pipe cannot see.
 *
 * Only asserts when both ends are present, so an optional filter with one end
 * set still means "from here onwards" / "up to here". A backwards range would
 * otherwise return zero rows, and on a finance screen "nothing was received
 * that week" is the one wrong answer that gets acted on.
 */
export function assertDateOrder(
  from: string | undefined,
  to: string | undefined,
  names: { from: string; to: string } = { from: 'from', to: 'to' },
): void {
  if (!from || !to) return;
  if (to < from) {
    throw new BadRequestException(`${names.to} (${to}) is before ${names.from} (${from})`);
  }
}
