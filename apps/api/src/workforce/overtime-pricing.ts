import {
  ACT_OVERTIME_MULTIPLIERS,
  FIRST_SCHEDULE_WAGE_CEILING_CENTS,
  MONTHLY_ORP_DIVISOR,
  OVERTIME_MULTIPLIERS,
  OvertimeEntitlementBasis,
  OvertimeMultipliers,
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

/**
 * A FESTIVE_HOLIDAY is a public holiday the clinic marked festive on its
 * calendar: the Act prices it as a public holiday, and the rule set may hold
 * its own figures for it, never under the public holiday's.
 */
export type DayType = 'NORMAL_DAY' | 'REST_DAY' | 'PUBLIC_HOLIDAY' | 'FESTIVE_HOLIDAY';

/** Both kinds of public holiday, for the arithmetic that does not care which. */
export function isPublicHoliday(dayType: DayType): boolean {
  return dayType === 'PUBLIC_HOLIDAY' || dayType === 'FESTIVE_HOLIDAY';
}

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
  /** RM per FESTIVE public holiday worked. Absent or null means the public holiday shift. */
  readonly festiveHolidayShiftCents?: number | null;
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
  /**
   * THE CLINIC'S OWN MULTIPLIERS on the hour beyond normal hours, where it set
   * any. Absent means the Act's. Validated at or above the Act's before it is
   * ever stored, so nothing here has to defend the floor a second time — and a
   * clinic paying 2× for overtime is priced at 2×, not at 1.5× with the
   * difference quietly dropped.
   *
   * These apply to any day the ACT'S FORMULA prices, in either mode. A
   * clinic-rate rule set that fixes no amount for a kind of day falls back to
   * the formula, and falling back should land on the clinic's own answer
   * rather than on a number it replaced everywhere else.
   */
  readonly multipliers?: OvertimeMultipliers | null;
  /**
   * THE HOLIDAY'S OWN MULTIPLIER (decision 2, 14 October 2026), set per
   * holiday in Settings. Null means the rule set's. For somebody the Act
   * covers it never goes below the Act's.
   */
  readonly holidayMultiplier?: (date: Date) => number | null;
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

/**
 * The provision, and the clinic's own rate where it beat the Act's.
 *
 * A payslip saying only "s.60A(3)(a)" for an hour paid at 2× is a payslip that
 * cannot be checked: the reader works out 1.5×, finds a different number, and
 * has no way to tell generosity from a bug. Naming both settles it on the
 * document rather than in an email six months later.
 */
function sayRate(provision: string, used: number, act: number): string {
  if (used === act) return provision;
  if (used > act) return `${provision}, at the clinic's ${used}× rather than the Act's ${act}×`;
  // Below. The word has to be on the payslip, not inferable from two numbers.
  return `${provision}, at the clinic's ${used}× — BELOW the Act's minimum of ${act}×`;
}
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
  context: {
    readonly publicHolidayDates: ReadonlySet<string>;
    /** The holidays the clinic marked festive; a subset of the public holidays. Absent means none. */
    readonly festiveHolidayDates?: ReadonlySet<string>;
    readonly restDayOfWeek: number | null;
  },
): DayType {
  if (context.festiveHolidayDates?.has(iso(date))) return 'FESTIVE_HOLIDAY';
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

  const chosen = context.multipliers ?? ACT_OVERTIME_MULTIPLIERS;

  /*
   * A MULTIPLIER UNDER THE ACT'S IS A SHORTFALL, AND IS STILL PAID.
   *
   * The clinic set it, acknowledged what it was doing, and the figure it chose
   * is what the employee receives — overruling that would hide a decision
   * somebody made on purpose. What the day carries instead is BOTH numbers, so
   * the payslip can print them, the run can raise a warning naming this
   * person, and nobody has to reconstruct the shortfall later from a rate
   * table that has since changed.
   *
   * Only within the First Schedule. Above RM4,000 ss.60, 60A and 60D do not
   * apply, so there is no minimum to fall under and nothing to warn about.
   */
  const shortfall = (paidCents: number, actMultiplier: number, chosenMultiplier: number, atActCents: number) =>
    context.scope.withinFirstSchedule && chosenMultiplier < actMultiplier
      ? { statutoryFloorCents: atActCents, belowStatutoryFloor: true, clinicRateCents: paidCents }
      : { statutoryFloorCents: null, belowStatutoryFloor: false, clinicRateCents: null };

  if (dayType === 'NORMAL_DAY') {
    // The salary already covers the day. Only approved overtime is paid, and
    // only at the excess multiplier.
    const multiplier = chosen.normalDay;
    const excessHourlyRateCents = Math.round(context.hourlyOrpCents * multiplier);
    const excessPayCents = Math.round(approvedExcessHours * context.hourlyOrpCents * multiplier);
    return {
      attendanceId: day.attendanceId,
      date: day.date,
      dayType,
      ordinaryRateDays: 0,
      dayPayCents: 0,
      excessHours: approvedExcessHours,
      excessMultiplier: multiplier,
      excessHourlyRateCents,
      excessPayCents,
      totalCents: excessPayCents,
      provision: sayRate(
        entitlement === 'STATUTORY'
          ? 'Employment Act 1955, s.60A(3)(a)'
          : 'Company benefit at s.60A(3)(a) rates — outside the First Schedule limit',
        multiplier,
        OVERTIME_MULTIPLIERS.NORMAL_DAY,
      ),
      entitlement,
      unapprovedExcessHours: day.overtimeApproved ? 0 : day.overtimeMinutes / 60,
      ...byTheAct,
      ...shortfall(
        excessPayCents,
        OVERTIME_MULTIPLIERS.NORMAL_DAY,
        multiplier,
        Math.round(approvedExcessHours * context.hourlyOrpCents * OVERTIME_MULTIPLIERS.NORMAL_DAY),
      ),
    };
  }

  const dayRate = isPublicHoliday(dayType)
    ? publicHolidayEntitlement()
    : restDayEntitlement(context.basis, workedHours, context.normalHoursPerDay);

  // Hours beyond normal hours, from what was actually worked — a rest day has
  // no "normal hours" to exceed by roster, so the excess is measured against
  // the contractual working day.
  const excessWorked = Math.max(0, workedHours - context.normalHoursPerDay);
  const excessHours = day.overtimeApproved ? excessWorked : 0;

  // THE DAY AND THE HOURS ARE DIFFERENT NUMBERS. `ordinaryRateDays` is the day
  // itself under s.60(3)(b) or s.60D(3)(a)(i) — two days' wages for a public
  // holiday worked, however few hours — and the clinic does not set it. The
  // multiplier below applies only to the hours BEYOND normal hours.
  const ruleSetMultiplier =
    dayType === 'FESTIVE_HOLIDAY'
      ? (chosen.festiveHolidayExcess ?? chosen.publicHolidayExcess)
      : dayType === 'PUBLIC_HOLIDAY'
        ? chosen.publicHolidayExcess
        : chosen.restDayExcess;
  const holidayOwn = isPublicHoliday(dayType) ? (context.holidayMultiplier?.(day.date) ?? null) : null;
  const multiplier =
    holidayOwn === null
      ? ruleSetMultiplier
      : context.scope.withinFirstSchedule
        ? Math.max(holidayOwn, ACT_OVERTIME_MULTIPLIERS.publicHolidayExcess)
        : holidayOwn;
  const dayPayCents = Math.round(dayRate.ordinaryRateDays * context.dailyOrpCents);
  const excessPayCents = Math.round(excessHours * context.hourlyOrpCents * multiplier);

  return {
    attendanceId: day.attendanceId,
    date: day.date,
    dayType,
    ordinaryRateDays: dayRate.ordinaryRateDays,
    dayPayCents,
    excessHours,
    excessMultiplier: multiplier,
    excessHourlyRateCents: Math.round(context.hourlyOrpCents * multiplier),
    excessPayCents,
    totalCents: dayPayCents + excessPayCents,
    provision: sayRate(
      entitlement === 'STATUTORY' ? dayRate.provision : `Company benefit at ${dayRate.provision} rates — outside the First Schedule limit`,
      multiplier,
      dayRate.excessHourlyMultiplier,
    ),
    entitlement,
    unapprovedExcessHours: day.overtimeApproved ? 0 : excessWorked,
    ...byTheAct,
    ...shortfall(
      dayPayCents + excessPayCents,
      dayRate.excessHourlyMultiplier,
      multiplier,
      dayPayCents + Math.round(excessHours * context.hourlyOrpCents * dayRate.excessHourlyMultiplier),
    ),
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
  const shiftCents =
    dayType === 'FESTIVE_HOLIDAY'
      ? (rates.festiveHolidayShiftCents ?? rates.publicHolidayShiftCents)
      : dayType === 'PUBLIC_HOLIDAY'
        ? rates.publicHolidayShiftCents
        : rates.restDayShiftCents;
  const paidAsSession = isSession && rates.sessionCents !== null;
  const dayPayCents = paidAsSession ? rates.sessionCents : shiftCents;
  if (dayPayCents === null) return null;

  const excessWorked = Math.max(0, workedHours - context.normalHoursPerDay);
  const excessHours = day.overtimeApproved && rates.overtimeHourlyCents !== null ? excessWorked : 0;
  const excessPayCents = rates.overtimeHourlyCents === null ? 0 : Math.round(excessHours * rates.overtimeHourlyCents);
  const what = dayType === 'FESTIVE_HOLIDAY' ? 'festive holiday' : dayType === 'PUBLIC_HOLIDAY' ? 'public holiday' : 'rest day';
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
 * amount for this kind of day. Mode B otherwise.
 *
 * WHAT THE CLINIC SET IS WHAT IS PAID, INCLUDING WHEN IT IS LESS.
 *
 * This used to substitute the Act's figure and block the run. Two things were
 * wrong with that. It overruled a decision the clinic had taken deliberately —
 * and an employer is entitled to run that liability — and it put a figure on a
 * payslip that nobody in the clinic had chosen, which is the same defect as
 * the report that printed "clinic policy" over a hardcoded divisor.
 *
 * So the clinic's figure is paid, and the day carries BOTH: `clinicRateCents`
 * is what the employee receives, `statutoryFloorCents` what the Act requires,
 * and `belowStatutoryFloor` says the two differ in the direction that matters.
 * The run raises a warning naming this person, Settings marks the rule set
 * permanently, and the payslip prints both rates. What Kuwick will not do is
 * let it happen silently — the acknowledgement on the rule set is where the
 * clinic says, on the record and by name, that this is what it meant.
 *
 * Above the First Schedule there is no minimum to fall under, so nothing here
 * applies and the clinic's figure is simply the clinic's figure.
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
      ...atClinicRate,
      statutoryFloorCents: byTheAct.totalCents,
      belowStatutoryFloor: true,
      clinicRateCents: atClinicRate.totalCents,
      provision:
        `${rates.ruleSet} pays ${rm(atClinicRate.totalCents)} for this day — BELOW the Employment Act's ` +
        `${rm(byTheAct.totalCents)} (${byTheAct.provision}). The clinic set this rate and acknowledged that it is ` +
        'under the Act, so it is what is paid.',
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
 * TWO MONTHS' PRICING AS ONE, for a run that pays last month's overtime beside
 * this month's (UAT, 10 October 2026). Each month was priced on its own wages.
 */
export function combinePricing(...parts: OvertimePricing[]): OvertimePricing {
  const total = (pick: (part: OvertimePricing) => number) => parts.reduce((sum, part) => sum + pick(part), 0);
  return {
    days: parts.flatMap((part) => part.days),
    totalCents: total((part) => part.totalCents),
    normalDayHours: total((part) => part.normalDayHours),
    restDaysWorked: total((part) => part.restDaysWorked),
    publicHolidaysWorked: total((part) => part.publicHolidaysWorked),
    unapprovedExcessHours: total((part) => part.unapprovedExcessHours),
    belowStatutoryFloor: parts.flatMap((part) => part.belowStatutoryFloor),
  };
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
    publicHolidaysWorked: priced.filter((day) => isPublicHoliday(day.dayType) && day.totalCents > 0).length,
    unapprovedExcessHours: priced.reduce((sum, day) => sum + day.unapprovedExcessHours, 0),
    belowStatutoryFloor: priced.filter((day) => day.belowStatutoryFloor),
  };
}

/** The payslip line a priced day belongs on. */
export function dayTypeLabel(dayType: DayType): 'Overtime' | 'Rest day pay' | 'Public holiday pay' | 'Festive holiday pay' {
  switch (dayType) {
    case 'NORMAL_DAY':
      return 'Overtime';
    case 'REST_DAY':
      return 'Rest day pay';
    case 'FESTIVE_HOLIDAY':
      return 'Festive holiday pay';
    default:
      return 'Public holiday pay';
  }
}

/** "rest day", "public holiday" or "festive holiday", for a sentence about the day. */
function dayWord(dayType: DayType): string {
  return dayType === 'REST_DAY' ? 'rest day' : dayType === 'FESTIVE_HOLIDAY' ? 'festive holiday' : 'public holiday';
}

/** One line of plain English naming what was paid and under which section, or which rule set. */
export function describePricedDay(day: PricedDay): string {
  const when = iso(day.date);
  if (day.entitlement === 'NONE') {
    return `${when}: worked, nothing payable — ${day.provision}`;
  }
  if (day.belowStatutoryFloor) {
    // Both figures, on the line the employee reads. A payslip that says only
    // what was paid cannot be checked against the Act by the person it is
    // about, which is exactly who the minimum exists for.
    const paid = day.clinicRateCents ?? day.totalCents;
    const owed = day.statutoryFloorCents;
    const gap = owed === null ? '' : ` Paid ${rm(paid)}; the Act's figure for this day is ${rm(owed)}.`;
    return `${when}: ${day.provision}${gap}`;
  }
  if (day.pricedBy === 'CLINIC_RATE') {
    if (day.dayType === 'NORMAL_DAY') {
      return `${when}: ${day.excessHours.toFixed(2)}h overtime (${day.provision}).`;
    }
    return `${when}: worked a ${dayWord(day.dayType)} (${day.provision}).`;
  }
  if (day.dayType === 'NORMAL_DAY') {
    return `${when}: ${day.excessHours.toFixed(2)}h overtime at ${day.excessMultiplier}× (${day.provision}).`;
  }
  const label = dayWord(day.dayType);
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
  readonly rate: 'OVERTIME_HOURLY' | 'PUBLIC_HOLIDAY_SHIFT' | 'FESTIVE_HOLIDAY_SHIFT' | 'REST_DAY_SHIFT' | 'SESSION';
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
  hold('FESTIVE_HOLIDAY_SHIFT', rates.festiveHolidayShiftCents ?? null, Math.round(2 * daily), 'A festive holiday shift');
  hold('REST_DAY_SHIFT', rates.restDayShiftCents, Math.round(daily), 'A rest day shift');
  hold('SESSION', rates.sessionCents, Math.round(2 * daily), 'A session on a public holiday');
  return out;
}
