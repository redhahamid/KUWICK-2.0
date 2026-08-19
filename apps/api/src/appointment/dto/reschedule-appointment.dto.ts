import { IsBoolean, IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class RescheduleAppointmentDto {
  @IsDateString()
  scheduledStart!: string;

  @IsDateString()
  scheduledEnd!: string;

  /**
   * Moving the appointment to a DIFFERENT provider, which a reschedule
   * frequently is — the doctor called in sick and the patient is being moved
   * to a colleague. Absent = the same provider.
   */
  @IsOptional()
  @IsUUID()
  staffId?: string;

  /** Why. Shown in the appointment's history, and to the patient. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsBoolean()
  override?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  overrideReason?: string;
}
