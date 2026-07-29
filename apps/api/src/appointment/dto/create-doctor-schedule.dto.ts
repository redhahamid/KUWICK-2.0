import { IsDateString, IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';

const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

export class CreateDoctorScheduleDto {
  @IsUUID()
  clinicId!: string;

  @IsUUID()
  staffId!: string;

  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @Matches(TIME_RE)
  startTime!: string;

  @Matches(TIME_RE)
  endTime!: string;

  @IsDateString()
  effectiveFrom!: string;

  @IsOptional()
  @IsDateString()
  effectiveTo?: string;
}
