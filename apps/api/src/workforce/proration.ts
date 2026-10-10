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

/**
 * WHAT A DAY OF UNPAID LEAVE COSTS — s.18A, not clinic policy.
 *
 * Section 18A reaches ANY incomplete month, expressly including leave of
 * absence without pay for one or more days. So the divisor is the actual
 * length of the wage period — 28, 29, 30 or 31 — and the deduction is
 * `monthly wages × unpaid days / days in the period`.
 *
 * Kuwick deducted on a FIXED 31 as configurable clinic policy. In February that
 * under-deducts by 10%, and in every month shorter than 31 days by something.
 * More to the point it was never the employer's to configure: s.18A is the
 * rule, and a policy divisor cannot displace it.
 *
 * Derived as a deduction rather than by reducing basic pay so the payslip can
 * show it as a line somebody can question. Arithmetically it is the same thing:
 * `monthly × served/days − monthly × unpaid/days` is `monthly × eligible/days`,
 * which is exactly what s.18A says the wages are.
 */
export function unpaidLeaveDeductionCents(monthlyCents: number, unpaidDays: number, daysInPeriod: number): number {
  if (daysInPeriod <= 0 || unpaidDays <= 0) return 0;
  const clamped = Math.min(unpaidDays, daysInPeriod);
  return Math.round((monthlyCents / daysInPeriod) * clamped);
}

/**
 * One line of plain English for the payslip and the exception list. In
 * working days when the month was paid by them.
 */
export function describeProration(
  proration: Proration,
  daysInPeriod: number,
  workingDays: { readonly employed: number; readonly inPeriod: number } | null = null,
): string | null {
  if (proration.complete || proration.outsidePeriod) return null;
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  const when =
    proration.joinedOn && proration.leftOn
      ? `started on ${iso(proration.joinedOn)} and left on ${iso(proration.leftOn)}`
      : proration.joinedOn
        ? `started on ${iso(proration.joinedOn)}`
        : `left on ${iso(proration.leftOn as Date)}`;
  return workingDays
    ? `Paid for ${workingDays.employed} of ${workingDays.inPeriod} working days: they ${when}.`
    : `Paid for ${proration.daysEligible} of ${daysInPeriod} days: they ${when}.`;
}

/**
 * A PART MONTH BY WORKING DAYS — the clinic's choice, not the Act's (UAT,
 * 10 October 2026).
 *
 * s.18A pays an incomplete month by calendar days, and that stays the default.
 * A clinic whose contracts pay it by working days chooses so on the rule set:
 * monthly wages × working days employed ÷ working days in the month, both
 * counted from the employee's own working week.
 *
 * A day's weight comes from the week on their record. The rest day is not a
 * working day. On a five-day week neither is the day before it; on a
 * five-and-a-half-day week that day counts as half. Any other week, or a rest
 * day that varies or is not recorded, has no pattern to count from: the month
 * is paid by calendar days and says why. Public holidays are paid days and
 * count as the working days they fall on.
 *
 * Returns the weight of each day of the week, Sunday first, or null.
 */
export function workingWeek(week: {
  workDaysPerWeek: number | null;
  restDayOfWeek: number | null;
  restDayVaries: boolean;
}): number[] | null {
  const rest = week.restDayOfWeek;
  if (week.workDaysPerWeek === null || rest === null || rest < 0 || rest > 6 || week.restDayVaries) return null;
  const weights = [1, 1, 1, 1, 1, 1, 1];
  weights[rest] = 0;
  const dayBefore = (rest + 6) % 7;
  if (week.workDaysPerWeek === 6) return weights;
  if (week.workDaysPerWeek === 5.5) {
    weights[dayBefore] = 0.5;
    return weights;
  }
  if (week.workDaysPerWeek === 5) {
    weights[dayBefore] = 0;
    return weights;
  }
  return null;
}

/** Working days from one date to another, both included, by a week's weights. */
function workingDaysBetween(from: Date, to: Date, week: readonly number[]): number {
  let total = 0;
  for (let at = from.getTime(); at <= to.getTime(); at += DAY) total += week[new Date(at).getUTCDay()];
  return total;
}

export type PartMonthBasis = 'CALENDAR_DAYS' | 'WORKING_DAYS';

export interface PartMonthPay {
  /** The month's basic pay, in sen. */
  readonly basicCents: number;
  /** What s.18A's calendar days pay, in sen: the figure a working-day month is held against. */
  readonly calendarCents: number;
  /** How the figure above was worked out. */
  readonly basis: PartMonthBasis;
  /** Working days employed and in the month, when worked out by working days. */
  readonly workingDays: { readonly employed: number; readonly inPeriod: number } | null;
  /** Why a working-day rule set paid this month by calendar days, when it did. */
  readonly fallback: string | null;
}

/**
 * The month's basic pay under the rule set's part-month basis. A complete
 * month is the whole wage on either basis; so is anything the basis cannot be
 * worked out for, by calendar days, with the reason.
 */
export function partMonthPay(args: {
  monthlyCents: number;
  proration: Proration;
  window: EmploymentWindow;
  basis: string;
  week: readonly number[] | null;
}): PartMonthPay {
  const calendarCents = proratedBasicCents(args.monthlyCents, args.proration, args.window.daysInPeriod);
  const byCalendar: PartMonthPay = { basicCents: calendarCents, calendarCents, basis: 'CALENDAR_DAYS', workingDays: null, fallback: null };
  if (args.basis !== 'WORKING_DAYS' || args.proration.complete || args.proration.outsidePeriod) return byCalendar;
  if (!args.week) {
    return {
      ...byCalendar,
      fallback:
        'Their rule set pays a part month by working days, but their record has no fixed working week to count from ' +
        '(5, 5.5 or 6 days a week and a rest day that does not vary), so it is paid by calendar days.',
    };
  }
  const periodStart = atMidnight(args.window.periodStart);
  const periodLast = new Date(atMidnight(args.window.periodEnd).getTime() - DAY);
  const inPeriod = workingDaysBetween(periodStart, periodLast, args.week);
  const employed = workingDaysBetween(args.proration.joinedOn ?? periodStart, args.proration.leftOn ?? periodLast, args.week);
  if (inPeriod <= 0) return byCalendar;
  return {
    // Rounded to the sen once, at the end, as the calendar figure is.
    basicCents: Math.round((args.monthlyCents * employed) / inPeriod),
    calendarCents,
    basis: 'WORKING_DAYS',
    workingDays: { employed, inPeriod },
    fallback: null,
  };
}
