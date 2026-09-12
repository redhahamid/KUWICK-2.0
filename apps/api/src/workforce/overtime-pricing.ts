import {
  FIRST_SCHEDULE_WAGE_CEILING_CENTS,
  MONTHLY_ORP_DIVISOR,
  OVERTIME_MULTIPLIERS,
  OvertimeEntitlementBasis,
  OvertimeScope,
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
 * NOT EVERY EMPLOYEE WITH OVERTIME ON A TIMESHEET IS OWED OVERTIME PAY. The
 * First Schedule limits ss.60, 60A and 60D to employees whose wages do not
 * exceed RM4,000 a month. Above that the Act requires nothing, and whatever is
 * paid is a company benefit the employer undertook — a different obligation
 * with different consequences. Each priced day therefore carries the BASIS it
 * was paid on, and an employee out of statutory scope with no undertaking
 * recorded is paid nothing rather than silently given the Act's rates.
 *
 * APPROVAL AND ENTITLEMENT ARE DIFFERENT QUESTIONS, and the split below is
 * deliberate. The day-rate entitlement arises from having worked the day at
 * all, which the clock recorded, so it is paid whether or not anybody ticked
 * "overtime approved" — refusing it because of a missing tick would withhold
 * wages the Act says are owed. The EXCESS hours beyond normal hours are
 * overtime in the ordinary sense and keep the existing approval control.
 *
 * TWO WAYS TO PRICE A DAY, and a rule set chooses (Settings › Payroll
 * policies, §6 of the HR restructure):
 *
 *   A. STATUTORY — everything above. The Act's own arithmetic.
 *
 *   B. CLINIC RATE — fixed amounts the clinic set: RM per hour of approved
 *      overtime, RM per public-holiday shift, RM per rest-day shift, RM per
 *      session (a rest day or holiday worked for at most half the normal
 *      hours). This is how a clinic actually pays its doctors — "RM500 a
 *      public-holiday shift" — and it is set ONCE, in Settings, never typed
 *      into the payroll grid. A kind of day the rule set gives no amount for
 *      is priced by the Act's formula, so nothing is silently nil.
 *
 * THE ACT IS A FLOOR UNDER MODE B. For an employee the First Schedule reaches,
 * s.60I(2) lets the employer use its own method only where the result is not
 * lower than the Act's. So every clinic-priced day is also priced by the Act,
 * and where the clinic rate comes out lower the day is PAID AT THE ACT'S
 * FIGURE and flagged — the run raises a blocking exception naming the rule
 * set, so the clinic fixes the rate rather than underpaying by policy.
 */

export type DayType = 'NORMAL_DAY' | 'REST_DAY' | 'PUBLIC_HOLIDAY';

export interface WorkedDay {
  readonly attendanceId: string;
  readonly date: Date;
  readonly workedMinutes: number;
  readonly overtimeMinutes: number;
  readonly overtimeApproved: boolean;
}

/** Mode B — the amounts a rule set fixes. Null means "no amount for this kind of day". */
export interface ClinicRates {
  /** The rule set's name, for the payslip and the exception. */
  readonly ruleSet: string;
  /** RM per hour of approved overtime on a normal working day, in cents. */
  readonly overtimeHourlyCents: number | null;
  /** RM per public holiday worked, whatever the hours. */
  readonly publicHolidayShiftCents: number | null;
  /** RM per rest day worked beyond half the normal hours. */
  readonly restDayShiftCents: number | null;
  /** RM per session: a rest day or holiday worked for at most half the normal hours. */
  readonly sessionCents: number | null;
}

export interface PricingContext {
  readonly basis: PayBasis;
  /**
   * Whether the Act reaches this employee, and on what footing anything is
   * owed. Resolved once per employee from their wages and the employer's
   * undertaking — see `overtimeScope`.
   */
  readonly scope: OvertimeScope;
  /** Contractual normal hours in a working day. Bounded by s.60A(1). */
  readonly normalHoursPerDay: number;
  /** One day at the ordinary rate of pay, in cents. */
  readonly dailyOrpCents: number;
  /** The hourly rate, ALREADY ROUNDED TO THE SEN — see `ordinaryRates`. */
  readonly hourlyOrpCents: number;
  /** Mode B. Absent or null means mode A, the Act's formula. */
  readonly clinicRates?: ClinicRates | null;
}

/** Which arithmetic produced a day's figure. */
export type PricedBy = 'ACT' | 'CLINIC_RATE';

export interface PricedDay {
  readonly attendanceId: string;
  readonly date: Date;
  readonly dayType: DayType;
  /** Days of ordinary rate owed for the day's work itself. Nil on a normal day. */
  readonly ordinaryRateDays: number;
  readonly dayPayCents: number;
  readonly excessHours: number;
  readonly excessMultiplier: number;
  /** The hourly rate the excess hours were actually paid at, in cents. */
  readonly excessHourlyRateCents: number;
  readonly excessPayCents: number;
  readonly totalCents: number;
  /** Which section of the Act — or which rule set — produced this, verbatim, for the payslip. */
  readonly provision: string;
  /**
   * STATUTORY, CONTRACTUAL or NONE. A payslip that cannot say which is a
   * payslip that cannot distinguish what the law requires from what the
   * employer promised.
   */
  readonly entitlement: OvertimeEntitlementBasis;
  /** Set when hours were worked beyond normal hours but nobody approved them. */
  readonly unapprovedExcessHours: number;
  readonly pricedBy: PricedBy;
  /**
   * What the Act's formula pays for the same day, when a clinic rate was
   * asked for and the employee is within the First Schedule. Null otherwise.
   */
  readonly statutoryFloorCents: number | null;
  /**
   * The clinic rate came out below the Act. The figure above IS the Act's,
   * and the run raises a blocking exception so the rule set gets fixed.
   */
  readonly belowStatutoryFloor: boolean;
  /** The clinic rate's own figure, kept when it was below the floor. */
  readonly clinicRateCents: number | null;
}

const iso = (date: Date) => date.toISOString().slice(0, 10);
const rm = (cents: number) => `RM${(cents / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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

/** One day, priced under whichever section of the Act governs it — mode A. */
function priceDayByTheAct(day: WorkedDay, dayType: DayType, context: PricingContext): PricedDay {
  const workedHours = day.workedMinutes / 60;
  const approvedExcessHours = day.overtimeApproved ? day.overtimeMinutes / 60 : 0;
  const entitlement = context.scope.basis;
  const byTheAct = { pricedBy: 'ACT' as const, statutoryFloorCents: null, belowStatutoryFloor: false, clinicRateCents: null };

  // NOTHING IS OWED, and the hours are still recorded. An employee outside the
  // First Schedule whose employer undertook nothing is not underpaid by being
  // paid nil — they were never entitled — but the day must still appear, or
  // the timesheet and the payslip stop agreeing about what happened.
  if (entitlement === 'NONE') {
    return {
      attendanceId: day.attendanceId,
      date: day.date,
      dayType,
      ordinaryRateDays: 0,
      dayPayCents: 0,
      excessHours: 0,
      excessMultiplier: 0,
      excessHourlyRateCents: 0,
      excessPayCents: 0,
      totalCents: 0,
      provision: context.scope.reason,
      entitlement,
      unapprovedExcessHours: 0,
      ...byTheAct,
    };
  }

  if (dayType === 'NORMAL_DAY') {
    // The salary already covers the day. Only approved overtime is paid, and
    // only at the excess multiplier.
    const excessHourlyRateCents = Math.round(context.hourlyOrpCents * OVERTIME_MULTIPLIERS.NORMAL_DAY);
    const excessPayCents = Math.round(approvedExcessHours * context.hourlyOrpCents * OVERTIME_MULTIPLIERS.NORMAL_DAY);
    return {
      attendanceId: day.attendanceId,
      date: day.date,
      dayType,
      ordinaryRateDays: 0,
      dayPayCents: 0,
      excessHours: approvedExcessHours,
      excessMultiplier: OVERTIME_MULTIPLIERS.NORMAL_DAY,
      excessHourlyRateCents,
      excessPayCents,
      totalCents: excessPayCents,
      provision:
        entitlement === 'STATUTORY'
          ? 'Employment Act 1955, s.60A(3)(a)'
          : 'Company benefit at s.60A(3)(a) rates — outside the First Schedule limit',
      entitlement,
      unapprovedExcessHours: day.overtimeApproved ? 0 : day.overtimeMinutes / 60,
      ...byTheAct,
    };
  }

  const dayRate =
    dayType === 'PUBLIC_HOLIDAY'
      ? publicHolidayEntitlement()
      : restDayEntitlement(context.basis, workedHours, context.normalHoursPerDay);

  // Hours beyond normal hours, from what was actually worked — a rest day has
  // no "normal hours" to exceed by roster, so the excess is measured against
  // the contractual working day.
  const excessWorked = Math.max(0, workedHours - context.normalHoursPerDay);
  const excessHours = day.overtimeApproved ? excessWorked : 0;

  const dayPayCents = Math.round(dayRate.ordinaryRateDays * context.dailyOrpCents);
  const excessPayCents = Math.round(excessHours * context.hourlyOrpCents * dayRate.excessHourlyMultiplier);

  return {
    attendanceId: day.attendanceId,
    date: day.date,
    dayType,
    ordinaryRateDays: dayRate.ordinaryRateDays,
    dayPayCents,
    excessHours,
    excessMultiplier: dayRate.excessHourlyMultiplier,
    excessHourlyRateCents: Math.round(context.hourlyOrpCents * dayRate.excessHourlyMultiplier),
    excessPayCents,
    totalCents: dayPayCents + excessPayCents,
    provision:
      entitlement === 'STATUTORY' ? dayRate.provision : `Company benefit at ${dayRate.provision} rates — outside the First Schedule limit`,
    entitlement,
    unapprovedExcessHours: day.overtimeApproved ? 0 : excessWorked,
    ...byTheAct,
  };
}

/**
 * One day at the clinic's own rates — mode B. Null when the rule set fixes no
 * amount for this kind of day, in which case the Act's formula prices it.
 *
 * A rest day or public holiday is a SESSION when at most half the normal
 * hours were worked and a SHIFT otherwise — the same half-day line the Act
 * draws in s.60(3)(b). With no session rate a session is paid at the shift
 * rate: a clinic that set one figure for "a Sunday" meant any Sunday. Hours
 * beyond the normal day are paid at the clinic's hourly rate where one is
 * set, approved hours only, as on a normal day.
 */
function priceDayAtClinicRate(day: WorkedDay, dayType: DayType, context: PricingContext, rates: ClinicRates): PricedDay | null {
  const workedHours = day.workedMinutes / 60;
  // A clinic rate is the employer's undertaking. Within the First Schedule it
  // is the Act's entitlement met by another method (s.60I(2)); above it, a
  // company benefit.
  const entitlement: OvertimeEntitlementBasis = context.scope.withinFirstSchedule ? 'STATUTORY' : 'CONTRACTUAL';
  const shared = {
    attendanceId: day.attendanceId,
    date: day.date,
    dayType,
    entitlement,
    pricedBy: 'CLINIC_RATE' as const,
    statutoryFloorCents: null,
    belowStatutoryFloor: false,
    clinicRateCents: null,
  };

  if (dayType === 'NORMAL_DAY') {
    if (rates.overtimeHourlyCents === null) return null;
    const approvedExcessHours = day.overtimeApproved ? day.overtimeMinutes / 60 : 0;
    const excessPayCents = Math.round(approvedExcessHours * rates.overtimeHourlyCents);
    return {
      ...shared,
      ordinaryRateDays: 0,
      dayPayCents: 0,
      excessHours: approvedExcessHours,
      excessMultiplier: 0,
      excessHourlyRateCents: rates.overtimeHourlyCents,
      excessPayCents,
      totalCents: excessPayCents,
      provision: `Clinic rate, ${rates.ruleSet}: ${rm(rates.overtimeHourlyCents)} an hour`,
      unapprovedExcessHours: day.overtimeApproved ? 0 : day.overtimeMinutes / 60,
    };
  }

  const isSession = workedHours <= context.normalHoursPerDay / 2;
  const shiftCents = dayType === 'PUBLIC_HOLIDAY' ? rates.publicHolidayShiftCents : rates.restDayShiftCents;
  const paidAsSession = isSession && rates.sessionCents !== null;
  const dayPayCents = paidAsSession ? rates.sessionCents : shiftCents;
  if (dayPayCents === null) return null;

  const excessWorked = Math.max(0, workedHours - context.normalHoursPerDay);
  const excessHours = day.overtimeApproved && rates.overtimeHourlyCents !== null ? excessWorked : 0;
  const excessPayCents = rates.overtimeHourlyCents === null ? 0 : Math.round(excessHours * rates.overtimeHourlyCents);
  const what = dayType === 'PUBLIC_HOLIDAY' ? 'public holiday' : 'rest day';
  return {
    ...shared,
    ordinaryRateDays: 0,
    dayPayCents,
    excessHours,
    excessMultiplier: 0,
    excessHourlyRateCents: rates.overtimeHourlyCents ?? 0,
    excessPayCents,
    totalCents: dayPayCents + excessPayCents,
    provision:
      `Clinic rate, ${rates.ruleSet}: ${rm(dayPayCents)} per ${what} ${paidAsSession ? 'session' : 'shift'}` +
      (excessPayCents > 0 ? ` plus ${rm(rates.overtimeHourlyCents ?? 0)} an hour beyond normal hours` : ''),
    unapprovedExcessHours: day.overtimeApproved ? 0 : excessWorked,
  };
}

/**
 * One day, priced.
 *
 * Mode A when the context carries no clinic rates, or the rule set fixes no
 * amount for this kind of day. Mode B otherwise — held to the Act's floor for
 * an employee within the First Schedule: the lower clinic figure is kept on
 * the day for the exception to name, and the Act's figure is what is paid.
 */
export function priceDay(day: WorkedDay, dayType: DayType, context: PricingContext): PricedDay {
  const byTheAct = priceDayByTheAct(day, dayType, context);
  const rates = context.clinicRates ?? null;
  if (!rates) return byTheAct;
  const atClinicRate = priceDayAtClinicRate(day, dayType, context, rates);
  if (!atClinicRate) return byTheAct;
  if (!context.scope.withinFirstSchedule) return atClinicRate;
  if (atClinicRate.totalCents < byTheAct.totalCents) {
    return {
      ...byTheAct,
      pricedBy: 'CLINIC_RATE',
      statutoryFloorCents: byTheAct.totalCents,
      belowStatutoryFloor: true,
      clinicRateCents: atClinicRate.totalCents,
      provision:
        `${rates.ruleSet} pays ${rm(atClinicRate.totalCents)} for this day, below the Employment Act's ${rm(byTheAct.totalCents)}. ` +
        `Section 60I(2) makes the Act's figure a floor, so the Act's figure is paid (${byTheAct.provision}).`,
    };
  }
  return { ...atClinicRate, statutoryFloorCents: byTheAct.totalCents };
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
  /** Days a clinic rate would have underpaid against the Act. Paid at the Act's figure; the run blocks. */
  readonly belowStatutoryFloor: readonly PricedDay[];
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
    belowStatutoryFloor: priced.filter((day) => day.belowStatutoryFloor),
  };
}

/** The payslip line a priced day belongs on. */
export function dayTypeLabel(dayType: DayType): 'Overtime' | 'Rest day pay' | 'Public holiday pay' {
  return dayType === 'NORMAL_DAY' ? 'Overtime' : dayType === 'REST_DAY' ? 'Rest day pay' : 'Public holiday pay';
}

/** One line of plain English naming what was paid and under which section, or which rule set. */
export function describePricedDay(day: PricedDay): string {
  const when = iso(day.date);
  if (day.entitlement === 'NONE') {
    return `${when}: worked, nothing payable — ${day.provision}`;
  }
  if (day.belowStatutoryFloor) {
    return `${when}: ${day.provision}`;
  }
  if (day.pricedBy === 'CLINIC_RATE') {
    if (day.dayType === 'NORMAL_DAY') {
      return `${when}: ${day.excessHours.toFixed(2)}h overtime (${day.provision}).`;
    }
    return `${when}: worked a ${day.dayType === 'REST_DAY' ? 'rest day' : 'public holiday'} (${day.provision}).`;
  }
  if (day.dayType === 'NORMAL_DAY') {
    return `${when}: ${day.excessHours.toFixed(2)}h overtime at ${day.excessMultiplier}× (${day.provision}).`;
  }
  const label = day.dayType === 'REST_DAY' ? 'rest day' : 'public holiday';
  const excess =
    day.excessHours > 0 ? ` plus ${day.excessHours.toFixed(2)}h beyond normal hours at ${day.excessMultiplier}×` : '';
  return `${when}: worked a ${label} — ${day.ordinaryRateDays} day${day.ordinaryRateDays === 1 ? '' : 's'} at the ordinary rate${excess} (${day.provision}).`;
}

/**
 * THE SETTINGS-TIME CHECK OF A RULE SET AGAINST THE ACT, for one wage.
 *
 * The run checks each day exactly; this is the same floor stated in advance,
 * so a clinic sees the shortfall when it types the rate rather than on pay
 * day. Wages above the First Schedule limit have no floor. Where a session
 * rate is set it is what a public holiday worked for half a day would be paid
 * at, and s.60D(3) owes two days' wages for that regardless of hours — so a
 * session rate is held to the holiday floor, the stricter of the two days it
 * can price.
 */
export interface ClinicRateShortfall {
  readonly rate: 'OVERTIME_HOURLY' | 'PUBLIC_HOLIDAY_SHIFT' | 'REST_DAY_SHIFT' | 'SESSION';
  readonly clinicCents: number;
  readonly actCents: number;
  readonly sentence: string;
}

export function clinicRateShortfalls(
  rates: ClinicRates,
  monthlyWagesCents: number,
  normalHoursPerDay: number,
): ClinicRateShortfall[] {
  if (monthlyWagesCents > FIRST_SCHEDULE_WAGE_CEILING_CENTS) return [];
  const daily = monthlyWagesCents / MONTHLY_ORP_DIVISOR;
  const hourly = normalHoursPerDay > 0 ? Math.round(daily / normalHoursPerDay) : 0;
  const out: ClinicRateShortfall[] = [];
  const hold = (rate: ClinicRateShortfall['rate'], clinicCents: number | null, actCents: number, what: string) => {
    if (clinicCents === null || clinicCents >= actCents) return;
    out.push({ rate, clinicCents, actCents, sentence: `${what}: ${rm(clinicCents)} against the Act's ${rm(actCents)}.` });
  };
  hold('OVERTIME_HOURLY', rates.overtimeHourlyCents, Math.round(hourly * OVERTIME_MULTIPLIERS.NORMAL_DAY), 'An hour of overtime');
  hold('PUBLIC_HOLIDAY_SHIFT', rates.publicHolidayShiftCents, Math.round(2 * daily), 'A public holiday shift');
  hold('REST_DAY_SHIFT', rates.restDayShiftCents, Math.round(daily), 'A rest day shift');
  hold('SESSION', rates.sessionCents, Math.round(2 * daily), 'A session on a public holiday');
  return out;
}
