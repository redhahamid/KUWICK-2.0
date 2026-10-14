import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Matches, Max, Min, ValidateIf } from 'class-validator';
import { WORKFORCE_CATEGORIES } from '../workforce-category';

const BASES = ['FIXED_DAYS', 'WORKING_DAYS', 'CALENDAR_DAYS'] as const;
type Basis = (typeof BASES)[number];

const OVERTIME_MODES = ['STATUTORY', 'CLINIC_RATE'] as const;
export type OvertimeModeCode = (typeof OVERTIME_MODES)[number];

const OVERTIME_BASES = ['ACT', 'WEEKLY', 'AVERAGED'] as const;

const CATEGORY_KEYS = WORKFORCE_CATEGORIES.map((row) => row.key);

/** Ringgit and sen as a string, the shape every money DTO takes. */
const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
const MONEY_MESSAGE = 'Enter an amount in ringgit with at most two decimal places, e.g. 500 or 37.50.';

/**
 * A rule set: one proration basis, and how extra hours are priced.
 *
 * THERE WERE FIVE BASES AND NOW THERE IS ONE. The Employment Act had already
 * answered four of them, so they were a choice the law does not permit dressed
 * as a setting. Termination is the one it leaves to the employer, and it is
 * RECORDED, NOT APPLIED: the final settlement is not built.
 *
 * THE OVERTIME MODE IS APPLIED, from the next calculation. STATUTORY is the
 * Act's arithmetic; CLINIC_RATE prices from the fixed amounts below. Amounts
 * are optional one by one — a kind of day with none falls back to the Act —
 * but a clinic-rate rule set with no amount at all is refused, because it
 * would be a statutory rule set wearing the wrong name.
 */
export class UpsertPayrollPolicyDto {
  @IsOptional() @IsString() id?: string;
  @IsString() @Length(2, 120) name!: string;
  @IsOptional() @IsString() legalEmployerId?: string | null;

  /** The ordinary rate of pay. s.60I(1A) sets 26 and the run refuses more. */
  @IsOptional() @IsInt() @Min(1) @Max(31) overtimeDays?: number;

  /**
   * HOW THE REST OF THE YEAR IS ESTIMATED FOR MONTHLY TAX (the MTD method's
   * Y2). LHDN leaves the estimate to the employer, so it is a clinic's choice.
   * Absent keeps what the rule set already has.
   */
  @IsOptional() @IsIn(['CURRENT_MONTH', 'BASIC_ONLY', 'CONTRACTUAL_MONTHLY'])
  pcbProjectionBasis?: 'CURRENT_MONTH' | 'BASIC_ONLY' | 'CONTRACTUAL_MONTHLY';
  @IsOptional() @IsNumber() @Min(0.5) @Max(24) overtimeHoursPerDay?: number;

  /**
   * The last basis standing, and the only one the Act leaves to the employer.
   * Recorded, not applied: the final settlement is a feature to build.
   *
   * Salary proration, unpaid leave, the overtime basis and leave pay were here
   * too. ss.18A, 60I(1)(c) and 60I(1A) had already answered all four, so they
   * offered a clinic a choice the law does not give it — and every one of them
   * was read by no calculation at all.
   */
  @IsOptional() @IsIn(BASES) terminationBasis?: Basis;
  @IsOptional() @IsInt() @Min(1) @Max(31) terminationDays?: number;

  /**
   * HOW A PART MONTH IS PAID (UAT, 10 October 2026). CALENDAR_DAYS is s.18A
   * and the default; WORKING_DAYS is the clinic's own choice, counted from
   * each person's working week. A fixed-day month is not offered. Absent
   * keeps what the rule set has.
   */
  @IsOptional() @IsIn(['CALENDAR_DAYS', 'WORKING_DAYS']) partMonthBasis?: 'CALENDAR_DAYS' | 'WORKING_DAYS';

  /**
   * LATE JOINERS PAID THE NEXT MONTH (UAT, 10 October 2026). A day 1–28:
   * somebody who starts after it is paid that month's days in the next run.
   * Null: paid in the same month (the default). Absent keeps what it has.
   */
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsInt() @Min(1) @Max(28) lateJoinerCutoffDay?: number | null;

  /** §6 — STATUTORY (the Act's formula) or CLINIC_RATE (the amounts below). */
  @IsOptional() @IsIn(OVERTIME_MODES) overtimeMode?: OvertimeModeCode;
  /** RM per hour of approved overtime on a normal working day. */
  @IsOptional() @Matches(MONEY, { message: MONEY_MESSAGE }) clinicOvertimeHourly?: string | null;
  /** RM per public holiday worked, whatever the hours. */
  @IsOptional() @Matches(MONEY, { message: MONEY_MESSAGE }) clinicPublicHolidayShift?: string | null;
  /** RM per FESTIVE public holiday worked. Blank means the public holiday shift. */
  @IsOptional() @Matches(MONEY, { message: MONEY_MESSAGE }) clinicFestiveHolidayShift?: string | null;
  /** RM per rest day worked beyond half the normal hours. */
  @IsOptional() @Matches(MONEY, { message: MONEY_MESSAGE }) clinicRestDayShift?: string | null;
  /** RM per session: a rest day or holiday worked for at most half the normal hours. */
  @IsOptional() @Matches(MONEY, { message: MONEY_MESSAGE }) clinicSessionRate?: string | null;

  /*
   * THE CLINIC'S OWN MULTIPLIERS on the hour beyond normal hours. Null or
   * absent means the Act's.
   *
   * THE BOUNDS HERE ARE NOT THE ACT'S FLOOR. 0.01 to 10 rules out a typing
   * mistake, nothing more. ss.60A(3)(a), 60(3)(c) and 60D(3)(aa) set minimums
   * of 1.5×, 2× and 3×, and a figure under them is ALLOWED — a clinic may
   * decide to pay below the Act and carry the liability. The service requires
   * it to be acknowledged by name, with a reason, before it will store one.
   *
   * These price the HOURS, not the day. A public holiday worked is two days'
   * wages under s.60D(3)(a)(i) however few hours were done, and that is not
   * settable.
   */
  @IsOptional() @IsNumber() @Min(0.01) @Max(10) overtimeMultiplier?: number | null;
  @IsOptional() @IsNumber() @Min(0.01) @Max(10) restDayMultiplier?: number | null;
  @IsOptional() @IsNumber() @Min(0.01) @Max(10) publicHolidayMultiplier?: number | null;
  /** The hours on a FESTIVE public holiday. Blank means the public holiday multiplier. */
  @IsOptional() @IsNumber() @Min(0.01) @Max(10) festiveHolidayMultiplier?: number | null;

  /*
   * PAYING BELOW THE ACT IS A DECISION, AND A DECISION HAS AN AUTHOR.
   *
   * Sent true only when somebody ticked the confirmation in Settings having
   * read what is below what. `belowActReason` is their own words and is
   * required with it: a shortfall nobody can explain is a shortfall nobody can
   * defend to the Labour Department. Both are ignored when nothing is below
   * the Act.
   */
  @IsOptional() @IsBoolean() belowActAcknowledged?: boolean;
  @IsOptional() @IsString() @Length(4, 500) belowActReason?: string | null;
  /*
   * WEEK BY WEEK (Section C). Null keeps the old day-by-day approval. The
   * wage limit can only raise the Act's RM4,000; the service refuses lower.
   */
  @IsOptional() @IsIn([...OVERTIME_BASES, null]) overtimeBasis?: (typeof OVERTIME_BASES)[number] | null;
  @IsOptional() @IsNumber() @Min(1) @Max(84) weeklyNormalHours?: number;
  @IsOptional() @Matches(MONEY, { message: MONEY_MESSAGE }) overtimeWageCeiling?: string | null;
  @IsOptional() @Matches(MONEY, { message: MONEY_MESSAGE }) locumHourlyRate?: string | null;

  /** Which group of the workforce this rule set applies to, unless assigned by hand. */
  @IsOptional() @IsIn(CATEGORY_KEYS) workforceCategory?: string | null;

  @IsOptional() @IsBoolean() isDefault?: boolean;
}
