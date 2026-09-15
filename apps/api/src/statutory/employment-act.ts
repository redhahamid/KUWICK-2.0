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
 * AND SECTION 18A COVERS UNPAID LEAVE, not only joiners and leavers. It reaches
 * any incomplete month, expressly including "leave of absence without pay for
 * one or more days" — so a day of unpaid leave is priced at monthly wages over
 * the DAYS IN THAT MONTH, exactly as a part-month of service is.
 *
 * A clinic spreadsheet that deducts unpaid leave on a fixed 26-day month is
 * over-deducting by roughly a fifth of a day's pay per day absent. One that
 * uses a fixed 31 is under-deducting in every month shorter than 31 days, and
 * by 10% in February. Neither is the Act, and neither is a policy an employer
 * is free to adopt where s.18A governs.
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

/**
 * THE FIRST SCHEDULE — WHO THE OVERTIME PROVISIONS ACTUALLY REACH.
 *
 * Since the Employment (Amendment) Act 2022 came into force on 1 January 2023
 * the Act applies to ALL employees, but not every section does. The First
 * Schedule limits the hours-and-overtime provisions — s.60(3) rest-day pay,
 * s.60A overtime, s.60D(3) public-holiday pay — to employees whose WAGES DO
 * NOT EXCEED RM4,000 A MONTH.
 *
 * So an employee above the threshold who works a Sunday has NO STATUTORY
 * entitlement to rest-day pay. Whatever they are paid for it is a contractual
 * or company benefit, owed because the employer promised it and not because
 * the Act requires it. Those are different obligations with different
 * consequences, and a payroll that cannot tell them apart will either invent
 * an entitlement nobody has or withhold a benefit somebody was promised.
 *
 * WAGES, not gross pay. Section 2 excludes overtime and travelling allowance
 * from wages, so the threshold is tested against the contractual monthly wage
 * rather than against what the month happened to total.
 */
export const FIRST_SCHEDULE_WAGE_CEILING_CENTS = 400_000;

/**
 * When that limitation took its current form. Resolved by the PERIOD, so a
 * historical run is not re-judged against a rule that came later.
 */
export const FIRST_SCHEDULE_EFFECTIVE_FROM = new Date('2023-01-01T00:00:00.000Z');

/**
 * WHY AN EMPLOYEE IS OR IS NOT PAID FOR EXTRA HOURS.
 *
 * Three answers, and they are not degrees of the same thing:
 *
 *  - STATUTORY — the Act requires it, at its own rates, as a floor.
 *  - CONTRACTUAL — the Act does not reach this employee, and the employer has
 *    undertaken to pay it anyway. The rates are the employer's.
 *  - NONE — the Act does not reach them and the employer has undertaken
 *    nothing. Hours are recorded; no money is owed.
 */
export type OvertimeEntitlementBasis = 'STATUTORY' | 'CONTRACTUAL' | 'NONE';

export interface OvertimeScope {
  readonly withinFirstSchedule: boolean;
  readonly basis: OvertimeEntitlementBasis;
  /** One line for the payslip and the exception list. */
  readonly reason: string;
}

/**
 * Whether the Act's overtime provisions reach this employee, and on what basis
 * anything is owed.
 *
 * `contractualPolicy` is what the EMPLOYER has undertaken for employees the Act
 * does not reach. It is deliberately not defaulted: an employer either promised
 * overtime pay to a senior employee or did not, and neither answer can be
 * guessed from a salary figure.
 */
export function overtimeScope(
  monthlyWagesCents: number,
  on: Date,
  contractualPolicy: 'PAY_AT_STATUTORY_RATES' | 'NOT_PAID' | null,
): OvertimeScope {
  // Before the limitation took its current form this system holds no rule to
  // apply, so it says so rather than assuming today's threshold applied then.
  if (on < FIRST_SCHEDULE_EFFECTIVE_FROM) {
    return {
      withinFirstSchedule: false,
      basis: 'NONE',
      reason:
        'This period predates the First Schedule limitation this system holds (1 January 2023), so overtime entitlement cannot be determined for it.',
    };
  }

  if (monthlyWagesCents <= FIRST_SCHEDULE_WAGE_CEILING_CENTS) {
    return {
      withinFirstSchedule: true,
      basis: 'STATUTORY',
      reason:
        'Wages are within the First Schedule limit of RM4,000 a month, so ss.60, 60A and 60D apply and their rates are a floor.',
    };
  }

  if (contractualPolicy === 'PAY_AT_STATUTORY_RATES') {
    return {
      withinFirstSchedule: false,
      basis: 'CONTRACTUAL',
      reason:
        'Wages exceed the First Schedule limit of RM4,000 a month, so the Act’s overtime provisions do not apply. This is paid as a company benefit at the same rates.',
    };
  }
  if (contractualPolicy === 'NOT_PAID') {
    return {
      withinFirstSchedule: false,
      basis: 'NONE',
      reason:
        'Wages exceed the First Schedule limit of RM4,000 a month and no overtime benefit is contracted, so no payment is due for extra hours.',
    };
  }
  return {
    withinFirstSchedule: false,
    basis: 'NONE',
    reason:
      'Wages exceed the First Schedule limit of RM4,000 a month, so the Act’s overtime provisions do not reach this employee. Whether they are paid anything is the employer’s undertaking, and none is recorded.',
  };
}

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
 * THE MULTIPLIERS A RUN ACTUALLY USES.
 *
 * "Not less than" cuts one way only, so a clinic gets to choose its own three
 * numbers and the Act's are the floor under each. A clinic paying overtime at
 * 2× is not breaking s.60A(3)(a); a clinic paying it at 1.25× is, and the
 * product refuses that the way it refuses a 30-day divisor.
 *
 * Every field is optional. Absent means the Act's, which is what every rule
 * set had before the clinic was asked.
 */
export interface OvertimeMultipliers {
  readonly normalDay: number;
  readonly restDayExcess: number;
  readonly publicHolidayExcess: number;
}

export const ACT_OVERTIME_MULTIPLIERS: OvertimeMultipliers = {
  normalDay: OVERTIME_MULTIPLIERS.NORMAL_DAY,
  restDayExcess: OVERTIME_MULTIPLIERS.REST_DAY_EXCESS,
  publicHolidayExcess: OVERTIME_MULTIPLIERS.PUBLIC_HOLIDAY_EXCESS,
};

/**
 * THE THREE FLOORS, IN ONE PLACE, so the Settings screen, the DTO and the
 * refusal sentence cannot drift apart. `field` is the name the API and the web
 * form both use, which is also the id the refusal is anchored to on screen.
 *
 * WHAT THESE ARE NOT. Each is the multiplier on an HOUR beyond normal hours.
 * The DAY itself on a rest day or a public holiday is priced in days of
 * ordinary rate by ss.60(3)(b) and 60D(3)(a)(i) — a public holiday worked is
 * two days' wages however few hours were done — and that is a different
 * number, not settable here.
 */
export const OVERTIME_MULTIPLIER_FLOORS = [
  {
    field: 'overtimeMultiplier',
    key: 'normalDay',
    act: OVERTIME_MULTIPLIERS.NORMAL_DAY,
    label: 'Overtime',
    what: 'an hour of overtime on a normal working day',
    provision: 'Employment Act 1955, s.60A(3)(a)',
  },
  {
    field: 'restDayMultiplier',
    key: 'restDayExcess',
    act: OVERTIME_MULTIPLIERS.REST_DAY_EXCESS,
    label: 'Rest day',
    what: 'an hour beyond normal hours on a rest day',
    provision: 'Employment Act 1955, s.60(3)(c)',
  },
  {
    field: 'publicHolidayMultiplier',
    key: 'publicHolidayExcess',
    act: OVERTIME_MULTIPLIERS.PUBLIC_HOLIDAY_EXCESS,
    label: 'Public holiday',
    what: 'an hour beyond normal hours on a public holiday',
    provision: 'Employment Act 1955, s.60D(3)(aa)',
  },
] as const satisfies readonly {
  readonly field: string;
  readonly key: keyof OvertimeMultipliers;
  readonly act: number;
  readonly label: string;
  readonly what: string;
  readonly provision: string;
}[];

/**
 * Why a chosen multiplier cannot be used, or null when it can.
 *
 * The same sentence the clinic reads in Settings and the same one the API
 * returns, because a refusal that is worded differently in two places is two
 * refusals to explain.
 */
export function overtimeMultiplierRefusal(field: string, value: number): string | null {
  const floor = OVERTIME_MULTIPLIER_FLOORS.find((row) => row.field === field);
  if (!floor) return `${field} is not a multiplier this rule set holds.`;
  if (!Number.isFinite(value) || value <= 0) return `${floor.label} is a multiplier above zero, such as ${floor.act}.`;
  if (value > 10) return `${floor.label} of ${value}× is higher than any rate a clinic pays. Check the figure.`;
  if (value < floor.act) {
    return (
      `${floor.label} of ${value}× pays less for ${floor.what} than ${floor.provision} allows, which is ${floor.act}×. ` +
      'A higher multiplier is yours to set; a lower one is not.'
    );
  }
  return null;
}

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
