import { IsDateString, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { AppointmentSource } from '@prisma/client';

export class CreateAppointmentDto {
  @IsUUID()
  clinicId!: string;

  @IsUUID()
  patientId!: string;

  @IsUUID()
  staffId!: string;

  @IsUUID()
  serviceId!: string;

  @IsEnum(AppointmentSource)
  source!: AppointmentSource;

  @IsDateString()
  scheduledStart!: string;

  @IsDateString()
  scheduledEnd!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
