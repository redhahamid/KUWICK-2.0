import { IsBoolean, IsInt, IsNumber, IsOptional, IsUUID, Length, Matches, Max, Min, ValidateIf } from 'class-validator';

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

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

  /** 0 Sunday … 6 Saturday; null inherits (UAT, 14 October 2026). */
  @ValidateIf((o) => o.weekStartDay !== null) @IsOptional() @IsInt() @Min(0) @Max(6) weekStartDay?: number | null;
  /** Opening hours, one fact: all three together; null on all three inherits. */
  @ValidateIf((o) => o.open24Hours !== null) @IsOptional() @IsBoolean() open24Hours?: boolean | null;
  @ValidateIf((o) => o.openTime !== null) @IsOptional() @Matches(TIME, { message: 'Times are HH:MM, e.g. 08:00.' }) openTime?: string | null;
  @ValidateIf((o) => o.closeTime !== null) @IsOptional() @Matches(TIME, { message: 'Times are HH:MM, e.g. 22:00.' }) closeTime?: string | null;

  @IsOptional() @Length(3, 500) reason?: string;
}
