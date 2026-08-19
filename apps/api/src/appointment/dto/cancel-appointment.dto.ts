import { IsEnum, IsOptional, IsString } from 'class-validator';
import { AppointmentCancellationReason } from '@prisma/client';

export class CancelAppointmentDto {
  /** What a person typed. */
  @IsOptional()
  @IsString()
  cancelReason?: string;

  /**
   * The countable half. RESCHEDULED is written by the reschedule flow itself
   * and should not normally be sent here — cancelling with that reason and no
   * replacement would claim a successor that does not exist.
   */
  @IsOptional()
  @IsEnum(AppointmentCancellationReason)
  cancellationReason?: AppointmentCancellationReason;
}
