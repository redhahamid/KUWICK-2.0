import { IsDateString, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

export class CreateScheduleExceptionDto {
  @IsUUID()
  clinicId!: string;

  @IsUUID()
  staffId!: string;

  @IsDateString()
  date!: string;

  @IsOptional()
  @Matches(TIME_RE)
  startTime?: string;

  @IsOptional()
  @Matches(TIME_RE)
  endTime?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
