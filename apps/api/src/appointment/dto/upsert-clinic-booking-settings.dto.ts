import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

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

  /**
   * PHASE 3 — the diary axis, display only. These fields MERGE: absent leaves
   * the stored value alone (the booking-window card and the calendar-display
   * card save independently), an empty time string clears it.
   */
  @IsOptional()
  @IsIn(['STANDARD_HOURS', 'TWENTY_FOUR_HOURS'])
  calendarDisplayMode?: 'STANDARD_HOURS' | 'TWENTY_FOUR_HOURS';

  /** "HH:MM" wall clock — the branch's stated opening hour, for display. */
  @IsOptional()
  @IsString()
  displayOpenTime?: string;

  @IsOptional()
  @IsString()
  displayCloseTime?: string;

  /** Breathing room either side of the stated hours, 0–240 minutes. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(240)
  displayPaddingMinutes?: number;
}
