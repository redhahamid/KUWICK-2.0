import {
  OVERTIME_MULTIPLIERS,
  PayBasis,
  publicHolidayEntitlement,
  restDayEntitlement,
} from '../statutory/employment-act';

/**
 * WHAT A DAY OF WORK IS WORTH, WHICH DEPENDS ON WHICH DAY IT WAS.
 *
 * Payroll pooled every approved overtime minute in the month and paid the lot
 * at 1.5×. The Employment Act prices three different things:
 *
 *   * A NORMAL WORKING DAY — s.60A(3)(a). Hours beyond normal hours at not
 *     less than 1.5× the hourly rate. The day itself is already covered by a
 *     monthly salary, so only the excess is paid.
 *
 *   * A REST DAY — s.60(3). NOT priced in hours at all. A monthly-rated
 *     employee who works any part of a rest day is owed half a day's wages at
 *     the ordinary rate, or a whole day if they worked more than half their
 *     normal hours — and then 2× hourly for anything beyond normal hours.
 *
 *   * A PAID PUBLIC HOLIDAY — s.60D(3). TWO days' wages at the ordinary rate,
 *     "regardless that the period of work done on that day is less than the
 *     normal hours of work", in addition to the holiday pay already owed. Then
 *     3× hourly beyond normal hours.
 *
 * So an employee who came in for two hours on a public holiday was paid three
 * hours' worth (2 × 1.5) where the Act owes them two days. Every one of those
 * errors was an UNDERPAYMENT, which is the employer's liability to settle.
 *
 * APPROVAL AND ENTITLEMENT ARE DIFFERENT QUESTIONS, and the split below is
 * deliberate. The day-rate entitlement arises from having worked the day at
 * all, which the clock recorded, so it is paid whether or not anybody ticked
 * "overtime approved" — refusing it because of a missing tick would withhold
 * wages the Act says are owed. The EXCESS hours beyond normal hours are
 * overtime in the ordinary sense and keep the existing approval control.
 */

export type DayType = 'NORMAL_DAY' | 'REST_DAY' | 'PUBLIC_HOLIDAY';

export interface WorkedDay {
  readonly attendanceId: string;
  readonly date: Date;
  readonly workedMinutes: number;
  readonly overtimeMinutes: number;
  readonly overtimeApproved: boolean;
}

export interface PricingContext {
  readonly basis: PayBasis;
  /** Contractual normal hours in a working day. Bounded by s.60A(1). */
  readonly normalHoursPerDay: number;
  /** One day at the ordinary rate of pay, in cents. */
  readonly dailyOrpCents: number;
  /** The hourly rate, ALREADY ROUNDED TO THE SEN — see `ordinaryRates`. */
  readonly hourlyOrpCents: number;
}

export interface PricedDay {
  readonly attendanceId: string;
  readonly date: Date;
  readonly dayType: DayType;
  /** Days of ordinary rate owed for the day's work itself. Nil on a normal day. */
  readonly ordinaryRateDays: number;
  readonly dayPayCents: number;
  readonly excessHours: number;
  readonly excessMultiplier: number;
  readonly excessPayCents: number;
  readonly totalCents: number;
  /** Which section of the Act produced this, verbatim, for the payslip. */
  readonly provision: string;
  /** Set when hours were worked beyond normal hours but nobody approved them. */
  readonly unapprovedExcessHours: number;
}

const iso = (date: Date) => date.toISOString().slice(0, 10);

/**
 * Which kind of day this was.
 *
 * A public holiday outranks a rest day: s.60D(3) is the more generous
 * provision, and a holiday falling on somebody's rest day is still a holiday.
 * A rest day is the one the employer DESIGNATED under s.59 — it is not
 * inferable from a roster, from a clinic's opening hours, or from the day
 * happening to be a Sunday, so an employee with none recorded has no rest day
 * this can find.
 */
export function classifyDay(
  date: Date,
  context: { readonly publicHolidayDates: ReadonlySet<string>; readonly restDayOfWeek: number | null },
): DayType {
  if (context.publicHolidayDates.has(iso(date))) return 'PUBLIC_HOLIDAY';
  if (context.restDayOfWeek !== null && date.getUTCDay() === context.restDayOfWeek) return 'REST_DAY';
  return 'NORMAL_DAY';
}

/** One day, priced under whichever section governs it. */
export function priceDay(day: WorkedDay, dayType: DayType, context: PricingContext): PricedDay {
  const workedHours = day.workedMinutes / 60;
  const approvedExcessHours = day.overtimeApproved ? day.overtimeMinutes / 60 : 0;

  if (dayType === 'NORMAL_DAY') {
    // The salary already covers the day. Only approved overtime is paid, and
    // only at the excess multiplier.
    const excessPayCents = Math.round(approvedExcessHours * context.hourlyOrpCents * OVERTIME_MULTIPLIERS.NORMAL_DAY);
    return {
      attendanceId: day.attendanceId,
      date: day.date,
      dayType,
      ordinaryRateDays: 0,
      dayPayCents: 0,
      excessHours: approvedExcessHours,
      excessMultiplier: OVERTIME_MULTIPLIERS.NORMAL_DAY,
      excessPayCents,
      totalCents: excessPayCents,
      provision: 'Employment Act 1955, s.60A(3)(a)',
      unapprovedExcessHours: day.overtimeApproved ? 0 : day.overtimeMinutes / 60,
    };
  }

  const entitlement =
    dayType === 'PUBLIC_HOLIDAY'
      ? publicHolidayEntitlement()
      : restDayEntitlement(context.basis, workedHours, context.normalHoursPerDay);

  // Hours beyond normal hours, from what was actually worked — a rest day has
  // no "normal hours" to exceed by roster, so the excess is measured against
  // the contractual working day.
  const excessWorked = Math.max(0, workedHours - context.normalHoursPerDay);
  const excessHours = day.overtimeApproved ? excessWorked : 0;

  const dayPayCents = Math.round(entitlement.ordinaryRateDays * context.dailyOrpCents);
  const excessPayCents = Math.round(excessHours * context.hourlyOrpCents * entitlement.excessHourlyMultiplier);

  return {
    attendanceId: day.attendanceId,
    date: day.date,
    dayType,
    ordinaryRateDays: entitlement.ordinaryRateDays,
    dayPayCents,
    excessHours,
    excessMultiplier: entitlement.excessHourlyMultiplier,
    excessPayCents,
    totalCents: dayPayCents + excessPayCents,
    provision: entitlement.provision,
    unapprovedExcessHours: day.overtimeApproved ? 0 : excessWorked,
  };
}

export interface OvertimePricing {
  readonly days: readonly PricedDay[];
  readonly totalCents: number;
  /** Approved overtime hours on ordinary working days. */
  readonly normalDayHours: number;
  readonly restDaysWorked: number;
  readonly publicHolidaysWorked: number;
  /** Hours beyond normal hours that nobody approved, across every day type. */
  readonly unapprovedExcessHours: number;
}

/**
 * A month of attendance, priced.
 *
 * Days with nothing to pay are dropped rather than carried as zeroes: a
 * payslip that lists twenty-two rows of nil is a payslip nobody reads.
 */
export function priceOvertime(
  days: readonly WorkedDay[],
  classify: (date: Date) => DayType,
  context: PricingContext,
): OvertimePricing {
  const priced = days
    .map((day) => priceDay(day, classify(day.date), context))
    .filter((day) => day.totalCents > 0 || day.unapprovedExcessHours > 0);

  return {
    days: priced,
    totalCents: priced.reduce((sum, day) => sum + day.totalCents, 0),
    normalDayHours: priced
      .filter((day) => day.dayType === 'NORMAL_DAY')
      .reduce((sum, day) => sum + day.excessHours, 0),
    restDaysWorked: priced.filter((day) => day.dayType === 'REST_DAY' && day.totalCents > 0).length,
    publicHolidaysWorked: priced.filter((day) => day.dayType === 'PUBLIC_HOLIDAY' && day.totalCents > 0).length,
    unapprovedExcessHours: priced.reduce((sum, day) => sum + day.unapprovedExcessHours, 0),
  };
}

/** One line of plain English naming what was paid and under which section. */
export function describePricedDay(day: PricedDay): string {
  const when = iso(day.date);
  if (day.dayType === 'NORMAL_DAY') {
    return `${when}: ${day.excessHours.toFixed(2)}h overtime at ${day.excessMultiplier}× (${day.provision}).`;
  }
  const label = day.dayType === 'REST_DAY' ? 'rest day' : 'public holiday';
  const excess =
    day.excessHours > 0 ? ` plus ${day.excessHours.toFixed(2)}h beyond normal hours at ${day.excessMultiplier}×` : '';
  return `${when}: worked a ${label} — ${day.ordinaryRateDays} day${day.ordinaryRateDays === 1 ? '' : 's'} at the ordinary rate${excess} (${day.provision}).`;
}
