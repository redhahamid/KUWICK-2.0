import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { WORKFORCE_CATEGORIES } from '../workforce-category';

const BASES = ['FIXED_DAYS', 'WORKING_DAYS', 'CALENDAR_DAYS'] as const;
type Basis = (typeof BASES)[number];

const OVERTIME_MODES = ['STATUTORY', 'CLINIC_RATE'] as const;
export type OvertimeModeCode = (typeof OVERTIME_MODES)[number];

const CATEGORY_KEYS = WORKFORCE_CATEGORIES.map((row) => row.key);

/** Ringgit and sen as a string, the shape every money DTO takes. */
const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
const MONEY_MESSAGE = 'Enter an amount in ringgit with at most two decimal places, e.g. 500 or 37.50.';

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
  /** Which group of the workforce this rule set applies to, unless assigned by hand. */
  @IsOptional() @IsIn(CATEGORY_KEYS) workforceCategory?: string | null;

  @IsOptional() @IsBoolean() isDefault?: boolean;
}
