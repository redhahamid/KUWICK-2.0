import { IsDateString } from 'class-validator';

export class UpdateDoctorScheduleDto {
  @IsDateString()
  effectiveTo!: string;
}
