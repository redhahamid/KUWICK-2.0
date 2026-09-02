import { incompleteMonthWagesCents } from '../statutory/employment-act';

/**
 * JOINERS AND LEAVERS — s.18A of the Employment Act 1955.
 *
 * Payroll included everybody whose employment status was ACTIVE, PROBATION or
 * NOTICE and paid each of them a full month. Nothing anywhere consulted the
 * date they actually started or finished. Somebody who joined on the 20th was
 * paid for the whole month; somebody who left on the 3rd was paid for the whole
 * month as well, and both figures reached a payslip looking exactly like a
 * correct one.
 *
 * s.18A settles how an incomplete month is paid, and it is not a 26-day
 * divisor: it is the monthly wage divided by the number of days in the WAGE
 * PERIOD, multiplied by the days the employee was eligible. A 31-day month
 * divides by 31; a 28-day month by 28. That differs from the ordinary rate of
 * pay under s.60I(1A), which divides by 26 — two divisors that answer two
 * different questions, and conflating them is the mistake this module exists to
 * keep out of the calculation.
 *
 * THE ORDINARY RATE IS NOT PRORATED. A joiner's overtime is priced from their
 * contractual monthly wage, not from the part-month they happen to be paid, or
 * their first month's overtime would be cheaper than every month after it.
 */

export interface EmploymentWindow {
  /** First day of the pay period, UTC midnight. */
  readonly periodStart: Date;
  /** First day of the FOLLOWING period, UTC midnight — exclusive. */
  readonly periodEnd: Date;
  /** Days in the wage period. The s.18A divisor. */
  readonly daysInPeriod: number;
  readonly startDate: Date | null | undefined;
  readonly endDate: Date | null | undefined;
}

export interface Proration {
  /** True when the employee served the whole period and nothing is prorated. */
  readonly complete: boolean;
  readonly daysEligible: number;
  /** Set when the employee joined inside this period. */
  readonly joinedOn: Date | null;
  /** Set when they left inside it. */
  readonly leftOn: Date | null;
  /**
   * True when they were not employed during this period AT ALL — a leaver
   * still marked active, or somebody whose start date has not arrived. They
   * are not a prorated payslip; they are not on this payroll.
   */
  readonly outsidePeriod: boolean;
}

const DAY = 86_400_000;

/** UTC midnight, so a time-of-day on a stored date cannot shift a day count. */
function atMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * How much of one pay period an employee actually served.
 *
 * Both ends are INCLUSIVE of the day worked: somebody who starts on the 1st and
 * leaves on the 31st of a 31-day month served 31 days, not 30. Getting that
 * wrong costs every leaver exactly one day's pay, which is the kind of error
 * that survives for years because each instance is small.
 */
export function prorationFor(window: EmploymentWindow): Proration {
  const periodStart = atMidnight(window.periodStart);
  // The last day of the period, inclusive.
  const periodLast = new Date(atMidnight(window.periodEnd).getTime() - DAY);

  const started = window.startDate ? atMidnight(window.startDate) : null;
  const ended = window.endDate ? atMidnight(window.endDate) : null;

  if ((started && started > periodLast) || (ended && ended < periodStart)) {
    return { complete: false, daysEligible: 0, joinedOn: null, leftOn: null, outsidePeriod: true };
  }

  const from = started && started > periodStart ? started : periodStart;
  const to = ended && ended < periodLast ? ended : periodLast;
  const daysEligible = Math.round((to.getTime() - from.getTime()) / DAY) + 1;

  return {
    complete: daysEligible >= window.daysInPeriod,
    daysEligible,
    joinedOn: started && started > periodStart ? started : null,
    leftOn: ended && ended < periodLast ? ended : null,
    outsidePeriod: false,
  };
}

/**
 * The month's basic pay, prorated if the month was incomplete.
 *
 * Rounded to the sen at the end and only at the end. Rounding the daily rate
 * first and multiplying leaves a figure a few sen out on most part-months,
 * which is enough to make a reconciliation against a payslip impossible to sign
 * off without somebody deciding the difference does not matter — and that habit
 * is how larger differences later get waved through.
 */
export function proratedBasicCents(monthlyCents: number, proration: Proration, daysInPeriod: number): number {
  if (proration.complete) return monthlyCents;
  return Math.round(incompleteMonthWagesCents(monthlyCents, daysInPeriod, proration.daysEligible));
}

/** One line of plain English for the payslip and the exception list. */
export function describeProration(proration: Proration, daysInPeriod: number): string | null {
  if (proration.complete || proration.outsidePeriod) return null;
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  const when =
    proration.joinedOn && proration.leftOn
      ? `started on ${iso(proration.joinedOn)} and left on ${iso(proration.leftOn)}`
      : proration.joinedOn
        ? `started on ${iso(proration.joinedOn)}`
        : `left on ${iso(proration.leftOn as Date)}`;
  return `Paid for ${proration.daysEligible} of ${daysInPeriod} days: they ${when}.`;
}
