import { IsDateString } from 'class-validator';

export class RescheduleAppointmentDto {
  @IsDateString()
  scheduledStart!: string;

  @IsDateString()
  scheduledEnd!: string;
}
