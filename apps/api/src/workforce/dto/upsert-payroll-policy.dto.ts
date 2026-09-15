import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { OVERTIME_MULTIPLIER_FLOORS } from '../../statutory/employment-act';
import { WORKFORCE_CATEGORIES } from '../workforce-category';

const BASES = ['FIXED_DAYS', 'WORKING_DAYS', 'CALENDAR_DAYS'] as const;
type Basis = (typeof BASES)[number];

const OVERTIME_MODES = ['STATUTORY', 'CLINIC_RATE'] as const;
export type OvertimeModeCode = (typeof OVERTIME_MODES)[number];

const CATEGORY_KEYS = WORKFORCE_CATEGORIES.map((row) => row.key);

/** Ringgit and sen as a string, the shape every money DTO takes. */
const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
const MONEY_MESSAGE = 'Enter an amount in ringgit with at most two decimal places, e.g. 500 or 37.50.';

/** The Act's minimum for each settable multiplier, by the field name that holds it. */
const FLOOR = Object.fromEntries(OVERTIME_MULTIPLIER_FLOORS.map((row) => [row.field, row.act])) as Record<string, number>;

const floorMessage = (field: string) => {
  const floor = OVERTIME_MULTIPLIER_FLOORS.find((row) => row.field === field)!;
  return (
    `${floor.label} must be at least ${floor.act}× — ${floor.provision} sets that as the minimum for ${floor.what}. ` +
    'A higher multiplier is yours to set; a lower one is not.'
  );
};

/**
 * A rule set: five proration bases, and how extra hours are priced.
 *
 * THE PRORATION BASES ARE RECORDED, NOT YET APPLIED. Which basis is lawful is
 * an Employment Act question (statutory register EA-03) and is blocked.
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

  @IsOptional() @IsIn(BASES) salaryProrationBasis?: Basis;
  @IsOptional() @IsInt() @Min(1) @Max(31) salaryProrationDays?: number;

  @IsOptional() @IsIn(BASES) overtimeBasis?: Basis;
  @IsOptional() @IsInt() @Min(1) @Max(31) overtimeDays?: number;
  @IsOptional() @IsNumber() @Min(0.5) @Max(24) overtimeHoursPerDay?: number;

  @IsOptional() @IsIn(BASES) unpaidLeaveBasis?: Basis;
  @IsOptional() @IsInt() @Min(1) @Max(31) unpaidLeaveDays?: number;

  @IsOptional() @IsIn(BASES) leavePayBasis?: Basis;
  @IsOptional() @IsInt() @Min(1) @Max(31) leavePayDays?: number;

  /** The fifth basis, which the audited competitor lacks. */
  @IsOptional() @IsIn(BASES) terminationBasis?: Basis;
  @IsOptional() @IsInt() @Min(1) @Max(31) terminationDays?: number;

  /** §6 — STATUTORY (the Act's formula) or CLINIC_RATE (the amounts below). */
  @IsOptional() @IsIn(OVERTIME_MODES) overtimeMode?: OvertimeModeCode;
  /** RM per hour of approved overtime on a normal working day. */
  @IsOptional() @Matches(MONEY, { message: MONEY_MESSAGE }) clinicOvertimeHourly?: string | null;
  /** RM per public holiday worked, whatever the hours. */
  @IsOptional() @Matches(MONEY, { message: MONEY_MESSAGE }) clinicPublicHolidayShift?: string | null;
  /** RM per rest day worked beyond half the normal hours. */
  @IsOptional() @Matches(MONEY, { message: MONEY_MESSAGE }) clinicRestDayShift?: string | null;
  /** RM per session: a rest day or holiday worked for at most half the normal hours. */
  @IsOptional() @Matches(MONEY, { message: MONEY_MESSAGE }) clinicSessionRate?: string | null;

  /*
   * THE CLINIC'S OWN MULTIPLIERS on the hour beyond normal hours. Null or
   * absent means the Act's. The floors below are ss.60A(3)(a), 60(3)(c) and
   * 60D(3)(aa), which say "not less than" — so above is the clinic's to set
   * and below is refused here as well as in Settings, because a refusal that
   * only exists in the browser is not a refusal.
   *
   * These price the HOURS, not the day. A public holiday worked is two days'
   * wages under s.60D(3)(a)(i) however few hours were done, and that is not
   * settable.
   */
  @IsOptional()
  @IsNumber()
  @Min(FLOOR.overtimeMultiplier, { message: floorMessage('overtimeMultiplier') })
  @Max(10)
  overtimeMultiplier?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(FLOOR.restDayMultiplier, { message: floorMessage('restDayMultiplier') })
  @Max(10)
  restDayMultiplier?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(FLOOR.publicHolidayMultiplier, { message: floorMessage('publicHolidayMultiplier') })
  @Max(10)
  publicHolidayMultiplier?: number | null;
  /** Which group of the workforce this rule set applies to, unless assigned by hand. */
  @IsOptional() @IsIn(CATEGORY_KEYS) workforceCategory?: string | null;

  @IsOptional() @IsBoolean() isDefault?: boolean;
}
