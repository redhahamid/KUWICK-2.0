import { IsBoolean, IsInt, IsOptional, IsUUID, Length, Max, Min } from 'class-validator';

/**
 * Every field optional: a clinic may adjust one rule without restating the
 * other eight, and an omitted field keeps whatever the row already held.
 *
 * The bounds are sanity rather than policy. A twelve-hour grace period is not
 * a clinic's decision to make, it is a typo.
 */
export class SaveAttendancePolicyDto {
  /** Omit for the group default that every clinic without a row inherits. */
  @IsOptional() @IsUUID() clinicId?: string;

  @IsOptional() @IsInt() @Min(0) @Max(180) lateGraceMinutes?: number;
  @IsOptional() @IsInt() @Min(0) @Max(180) earlyOutGraceMinutes?: number;

  @IsOptional() @IsInt() @Min(0) @Max(480) overtimeMinimumMinutes?: number;
  @IsOptional() @IsInt() @Min(0) @Max(120) overtimeRoundingMinutes?: number;
  @IsOptional() @IsBoolean() overtimeRequiresApproval?: boolean;
  @IsOptional() @IsBoolean() countEarlyClockIn?: boolean;

  @IsOptional() @IsInt() @Min(0) @Max(240) unpaidBreakMinutes?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1440) breakAfterMinutes?: number;

  @IsOptional() @IsInt() @Min(4) @Max(24) maximumShiftHours?: number;

  @IsOptional() @Length(3, 500) reason?: string;
}
