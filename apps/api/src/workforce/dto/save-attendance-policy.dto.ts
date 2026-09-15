import { IsBoolean, IsInt, IsNumber, IsOptional, IsUUID, Length, Max, Min, ValidateIf } from 'class-validator';

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
  @IsOptional() @IsBoolean() countEarlyClockIn?: boolean;


  @IsOptional() @IsInt() @Min(4) @Max(24) maximumShiftHours?: number;
  /**
   * The branch's point for portal clock-ins. Both or neither: null clears
   * the point, and with it the check. A radius stays a radius.
   */
  @ValidateIf((o) => o.geofenceLat !== null) @IsOptional() @IsNumber() @Min(-90) @Max(90) geofenceLat?: number | null;
  @ValidateIf((o) => o.geofenceLng !== null) @IsOptional() @IsNumber() @Min(-180) @Max(180) geofenceLng?: number | null;
  @IsOptional() @IsInt() @Min(20) @Max(5000) geofenceRadiusMetres?: number;

  @IsOptional() @Length(3, 500) reason?: string;
}
