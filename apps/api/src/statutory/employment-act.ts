/**
 * EMPLOYMENT ACT 1955 (ACT 265) — THE PAYROLL ARITHMETIC.
 *
 * SOURCE (Tier A): Laws of Malaysia, Act 265, sections 18A, 60, 60A, 60D and
 * 60I. Supplied by the account holder as an extract of the payroll-relevant
 * provisions.
 *
 * TWO DIVISORS, BOTH STATUTORY, FOR TWO DIFFERENT QUESTIONS.
 *
 * This is the point the codebase had wrong, and the Act settles it plainly.
 *
 *   * Section 60I(1A) — the ORDINARY RATE OF PAY for a monthly-rated employee
 *     is `monthly rate of pay / 26`. That rate prices overtime, rest-day work
 *     and public-holiday work.
 *
 *   * Section 18A — an INCOMPLETE MONTH is
 *     `monthly wages / days in the wage period × days eligible`, and it opens
 *     with "Notwithstanding section 60I". So the divisor is the actual number
 *     of days in that month — 28, 29, 30 or 31 — and never 26.
 *
 * A clinic spreadsheet that deducts unpaid leave on a fixed 26-day month is
 * over-deducting by roughly a fifth of a day's pay per day absent. One that
 * uses a fixed 31 is under-deducting in every short month. Neither is the Act.
 *
 * WHAT AN EMPLOYER MAY CHANGE, AND WHAT IT MAY NOT.
 *
 * Section 60I(2) permits another method for the ordinary rate of pay, "but the
 * adoption of any other method or formula shall not result in a rate which is
 * less than" the statutory one. So clinic policy is a FLOOR, not a free
 * choice: a configured divisor above 26 produces a smaller hourly rate and is
 * unlawful. `checkOrdinaryRatePolicy` below enforces exactly that, and the
 * distinction between legal requirement and clinic policy is kept visible
 * rather than blended into one configurable number.
 */

/** Section 60I(1A)-(1C): the divisor depends on how pay is fixed. */
export type PayBasis = 'MONTHLY' | 'WEEKLY' | 'DAILY_OR_HOURLY_OR_PIECE';

/** Section 60I(1A) — a monthly rate divides by 26. */
export const MONTHLY_ORP_DIVISOR = 26;
/** Section 60I(1B) — a weekly rate divides by 6. */
export const WEEKLY_ORP_DIVISOR = 6;

/**
 * Section 60A(1) — the limits a contract's normal hours may not exceed.
 * These bound what a clinic may configure, they are not the configuration.
 */
export const MAX_HOURS_PER_DAY = 8;
export const MAX_SPREAD_OVER_HOURS_PER_DAY = 10;
export const MAX_HOURS_PER_WEEK = 45;
export const MAX_CONSECUTIVE_HOURS_WITHOUT_BREAK = 5;

/**
 * The multipliers the Act sets as MINIMUMS. Each is "not less than", so a
 * clinic may pay more and may never pay less.
 */
export const OVERTIME_MULTIPLIERS = {
  /** s.60A(3)(a) — overtime beyond normal hours on a normal working day. */
  NORMAL_DAY: 1.5,
  /** s.60(3)(c) — work beyond normal hours on a REST DAY. */
  REST_DAY_EXCESS: 2,
  /** s.60D(3)(aa) — work beyond normal hours on a PAID PUBLIC HOLIDAY. */
  PUBLIC_HOLIDAY_EXCESS: 3,
} as const;

export type OvertimeCategory = keyof typeof OVERTIME_MULTIPLIERS;

/**
 * REST-DAY AND PUBLIC-HOLIDAY WORK IS NOT PRICED IN HOURS.
 *
 * Sections 60(3)(b) and 60D(3)(a) pay it in DAYS of ordinary rate, by how much
 * of the normal day was worked — and only the excess beyond normal hours is
 * hourly. Treating a rest day as "hours × 2" is wrong in both directions: it
 * underpays somebody who worked two hours (the Act gives them half a day) and
 * it overpays somebody who worked a full day plus overtime.
 */
export interface DayRateEntitlement {
  /** Days of ordinary rate of pay owed for the day's work itself. */
  readonly ordinaryRateDays: number;
  /** The multiplier for any hours beyond normal hours. */
  readonly excessHourlyMultiplier: number;
  /** The provision this came from, for the payslip and the audit. */
  readonly provision: string;
}

/**
 * Section 60(3)(b) — a monthly- or weekly-rated employee who works a rest day.
 * Section 60(3)(a) — a daily-, hourly- or similarly rated one, who is paid
 * more for the same work because their monthly wage does not already cover it.
 */
export function restDayEntitlement(basis: PayBasis, hoursWorked: number, normalHours: number): DayRateEntitlement {
  const half = normalHours / 2;
  if (basis === 'MONTHLY' || basis === 'WEEKLY') {
    return {
      ordinaryRateDays: hoursWorked <= half ? 0.5 : 1,
      excessHourlyMultiplier: OVERTIME_MULTIPLIERS.REST_DAY_EXCESS,
      provision: 'Employment Act 1955, s.60(3)(b) and s.60(3)(c)',
    };
  }
  return {
    ordinaryRateDays: hoursWorked <= half ? 1 : 2,
    excessHourlyMultiplier: OVERTIME_MULTIPLIERS.REST_DAY_EXCESS,
    provision: 'Employment Act 1955, s.60(3)(a) and s.60(3)(c)',
  };
}

/**
 * Section 60D(3)(a)(i) — work on a paid public holiday.
 *
 * Two days' wages at the ordinary rate, "regardless that the period of work
 * done on that day is less than the normal hours of work", and IN ADDITION to
 * the holiday pay already owed for the day. An employee who comes in for one
 * hour on Hari Raya is owed the full two days.
 */
export function publicHolidayEntitlement(): DayRateEntitlement {
  return {
    ordinaryRateDays: 2,
    excessHourlyMultiplier: OVERTIME_MULTIPLIERS.PUBLIC_HOLIDAY_EXCESS,
    provision: 'Employment Act 1955, s.60D(3)(a)(i) and s.60D(3)(aa)',
  };
}

/**
 * Section 60I(1A)-(1C) — the ordinary rate of pay, in cents.
 *
 * `wagesCents` is section 2 "wages", which is NOT basic salary alone: it is
 * what the contract entitles the employee to for the normal hours of one day.
 * Section 60I(1)(a) excludes payments under an approved incentive scheme, and
 * pay for work on a rest day or a public holiday — those are outputs of the
 * rate, so including them would compound.
 */
export function ordinaryRateOfPayCents(
  basis: PayBasis,
  wagesCents: number,
  options: { readonly divisorOverride?: number; readonly daysWorkedInPreviousPeriod?: number } = {},
): number {
  switch (basis) {
    case 'MONTHLY':
      return wagesCents / (options.divisorOverride ?? MONTHLY_ORP_DIVISOR);
    case 'WEEKLY':
      return wagesCents / (options.divisorOverride ?? WEEKLY_ORP_DIVISOR);
    case 'DAILY_OR_HOURLY_OR_PIECE': {
      // s.60I(1C): total wages of the preceding wage period divided by the days
      // actually worked in it. With no days worked there is no rate to compute,
      // and returning zero would silently price overtime at nothing.
      const days = options.daysWorkedInPreviousPeriod ?? 0;
      if (days <= 0) return Number.NaN;
      return wagesCents / days;
    }
  }
}

/** Section 60I(1)(b) — the hourly rate is the ordinary rate over normal hours. */
export function hourlyRateOfPayCents(ordinaryRateCents: number, normalHoursPerDay: number): number {
  if (normalHoursPerDay <= 0) return Number.NaN;
  return ordinaryRateCents / normalHoursPerDay;
}

/**
 * Section 60I(2) — a clinic may use its own method, but not a worse one.
 *
 * Returns the reason it is unlawful, or null when the policy is at least as
 * generous as the Act. A larger divisor makes each day worth less, so the
 * comparison is on the resulting RATE and not on the divisor itself.
 */
export function checkOrdinaryRatePolicy(basis: PayBasis, divisor: number): string | null {
  const statutory = basis === 'MONTHLY' ? MONTHLY_ORP_DIVISOR : basis === 'WEEKLY' ? WEEKLY_ORP_DIVISOR : null;
  if (statutory === null) return null;
  if (divisor <= 0) return 'A divisor of zero or less cannot produce a rate of pay.';
  if (divisor > statutory) {
    return (
      `Dividing a ${basis.toLowerCase()} wage by ${divisor} pays less per day than the Employment Act's ` +
      `${statutory}. Section 60I(2) lets an employer use its own method only where the result is not lower ` +
      `than the Act's, so this would underpay overtime, rest-day work and public-holiday work.`
    );
  }
  return null;
}

/**
 * SECTION 18A — WAGES FOR AN INCOMPLETE MONTH.
 *
 *     monthly wages
 *   ─────────────────────  ×  days eligible in the wage period
 *   days in the wage period
 *
 * It applies to a joiner after the first of the month, a leaver before the end
 * of it, unpaid leave of absence, and national service. `daysInWagePeriod` is
 * the actual length of that month.
 *
 * The result is the wages PAYABLE. The deduction is the difference, and
 * deriving it that way rather than computing a deduction directly is what
 * keeps a part-month joiner who also took unpaid leave from being charged
 * twice for the same days.
 */
export function incompleteMonthWagesCents(
  monthlyWagesCents: number,
  daysInWagePeriod: number,
  daysEligible: number,
): number {
  if (daysInWagePeriod <= 0) return Number.NaN;
  const clamped = Math.max(0, Math.min(daysEligible, daysInWagePeriod));
  return (monthlyWagesCents / daysInWagePeriod) * clamped;
}

/** The actual length of a month, which is what section 18A divides by. */
export function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

/**
 * Whether a contract's normal hours are within section 60A(1).
 *
 * Returns the reasons it is not, so a clinic setting up a 10-hour day is told
 * which limit it breaches rather than merely refused.
 */
export function checkNormalHours(hoursPerDay: number, hoursPerWeek: number): string[] {
  const problems: string[] = [];
  if (hoursPerDay > MAX_HOURS_PER_DAY) {
    problems.push(
      `Normal hours of ${hoursPerDay} a day exceed the Employment Act's limit of ${MAX_HOURS_PER_DAY} (s.60A(1)(b)).`,
    );
  }
  if (hoursPerWeek > MAX_HOURS_PER_WEEK) {
    problems.push(
      `Normal hours of ${hoursPerWeek} a week exceed the Employment Act's limit of ${MAX_HOURS_PER_WEEK} (s.60A(1)(d)).`,
    );
  }
  return problems;
}
