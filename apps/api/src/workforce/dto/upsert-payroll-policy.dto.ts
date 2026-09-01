import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';

const BASES = ['FIXED_DAYS', 'WORKING_DAYS', 'CALENDAR_DAYS'] as const;
type Basis = (typeof BASES)[number];

/**
 * Five independent proration bases.
 *
 * NO CALCULATION APPLIES ANY OF THEM YET. Which basis is lawful is an
 * Employment Act question (statutory register EA-03) and is blocked. The shape
 * exists so that turning it on later is configuration, not schema.
 */
export class UpsertPayrollPolicyDto {
  @IsOptional() @IsString() id?: string;
  @IsString() @Length(2, 120) name!: string;
  @IsOptional() @IsString() legalEmployerId?: string;

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

  @IsOptional() @IsBoolean() isDefault?: boolean;
}
