/**
 * LEAVE BALANCE — pure arithmetic over entitlement, carry-forward and what has
 * actually been approved.
 *
 * `taken` is always DERIVED from approved leave requests, never a stored
 * counter that is incremented on approval: a cancelled leave then returns its
 * days without a compensating edit, and a balance can never disagree with the
 * requests behind it.
 */

export interface LeaveDayRange {
  startDate: Date | string;
  endDate: Date | string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}

function toUtcDay(value: Date | string): number {
  const date = value instanceof Date ? value : new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Days in a leave request, INCLUSIVE of both ends.
 *
 * Monday to Monday is one day, not zero. This is the arithmetic people get
 * wrong most often and the reason it is a named function with a test.
 *
 * Non-working days are NOT excluded here: whether a Sunday inside a five-day
 * leave counts is a policy question, and the clinic's public-holiday calendar
 * and rest-day pattern answer it — not this function, which would otherwise be
 * silently imposing a five-day week on a clinic that opens seven.
 */
export function leaveDays(range: { startDate: Date | string; endDate: Date | string }): number {
  const start = toUtcDay(range.startDate);
  const end = toUtcDay(range.endDate);
  if (end < start) return 0;
  return Math.floor((end - start) / 86400000) + 1;
}

/** Days of a request that fall inside a calendar year — a leave spanning New Year splits. */
export function leaveDaysInYear(
  range: { startDate: Date | string; endDate: Date | string },
  year: number,
): number {
  const yearStart = Date.UTC(year, 0, 1);
  const yearEnd = Date.UTC(year, 11, 31);
  const start = Math.max(toUtcDay(range.startDate), yearStart);
  const end = Math.min(toUtcDay(range.endDate), yearEnd);
  if (end < start) return 0;
  return Math.floor((end - start) / 86400000) + 1;
}

export interface BalanceInput {
  entitledDays: number;
  carriedInDays?: number;
  adjustmentDays?: number;
  requests: LeaveDayRange[];
  year: number;
}

export interface LeaveBalanceResult {
  entitled: number;
  carriedIn: number;
  adjustment: number;
  /** Total available before anything is taken. */
  available: number;
  taken: number;
  /** Requested but not yet approved. Not deducted, but shown — a manager
   *  approving a request needs to know what else is pending. */
  pending: number;
  remaining: number;
  /** True when approved leave already exceeds the entitlement. */
  overdrawn: boolean;
}

export function computeLeaveBalance(input: BalanceInput): LeaveBalanceResult {
  const carriedIn = input.carriedInDays ?? 0;
  const adjustment = input.adjustmentDays ?? 0;
  const available = input.entitledDays + carriedIn + adjustment;

  let taken = 0;
  let pending = 0;
  for (const request of input.requests) {
    const days = leaveDaysInYear(request, input.year);
    if (request.status === 'APPROVED') taken += days;
    else if (request.status === 'PENDING') pending += days;
  }

  const remaining = available - taken;
  return {
    entitled: input.entitledDays,
    carriedIn,
    adjustment,
    available,
    taken,
    pending,
    remaining,
    overdrawn: remaining < 0,
  };
}

/**
 * Pro-rated entitlement for somebody who joined part-way through the year.
 *
 * Rounded to the nearest half day, which is how leave is actually granted.
 * A joiner on 1 January gets the full entitlement; a joiner on 1 July gets
 * half; somebody who left in March gets a quarter.
 */
export function proRateEntitlement(
  fullYearDays: number,
  year: number,
  startDate?: Date | string | null,
  endDate?: Date | string | null,
  /** Rounded to the nearest half day unless the clinic rounds to whole days. */
  step: 0.5 | 1 = 0.5,
): number {
  const yearStart = Date.UTC(year, 0, 1);
  const yearEnd = Date.UTC(year, 11, 31);
  const from = startDate ? Math.max(toUtcDay(startDate), yearStart) : yearStart;
  const to = endDate ? Math.min(toUtcDay(endDate), yearEnd) : yearEnd;
  if (to < from) return 0;

  const daysInYear = Math.floor((yearEnd - yearStart) / 86400000) + 1;
  const daysEmployed = Math.floor((to - from) / 86400000) + 1;
  const prorated = (fullYearDays * daysEmployed) / daysInYear;
  return Math.round(prorated / step) * step;
}
