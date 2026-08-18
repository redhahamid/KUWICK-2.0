import { IsInt, IsString, Max, Min } from 'class-validator';

export class UpsertClinicBookingSettingsDto {
  /** "HH:MM" wall clock in the clinic's own timezone. */
  @IsString()
  firstSessionTime!: string;

  @IsString()
  lastSessionTime!: string;

  /**
   * Capped at 90 days. Not an arbitrary number — beyond that the "minimum
   * notice" field is being used as a booking horizon, which is a different
   * setting, and letting it through would silently close the diary.
   */
  @IsInt()
  @Min(0)
  @Max(60 * 24 * 90)
  minimumNoticeMinutes!: number;
}
