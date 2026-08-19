import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpsertClinicBookingSettingsDto {
  /**
   * "HH:MM" wall clock in the clinic's own timezone, or empty/absent for
   * "we do not narrow that end". A 24-hour clinic leaves both blank — a
   * required 09:00-17:00 pair is exactly the fixed-office-hours assumption
   * that amputates a night roster.
   */
  @IsOptional()
  @IsString()
  firstSessionTime?: string;

  @IsOptional()
  @IsString()
  lastSessionTime?: string;

  /**
   * Capped at 90 days. Not an arbitrary number — beyond that the "minimum
   * notice" field is being used as a booking horizon, which is a different
   * setting, and letting it through would silently close the diary.
   */
  @IsInt()
  @Min(0)
  @Max(60 * 24 * 90)
  minimumNoticeMinutes!: number;

  /** How far ahead anybody may book here. Absent = no horizon. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(730)
  maxAdvanceDays?: number;

  /** Whether the tenant-wide public-holiday calendar closes THIS branch. */
  @IsOptional()
  @IsBoolean()
  observePublicHolidays?: boolean;
}
