import { IsDateString, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { LEAVE_CODE } from '../leave-types';

export class CreateLeaveRequestDto {
  @IsUUID()
  staffId!: string;

  @Matches(LEAVE_CODE, { message: 'Choose one of the clinic\'s leave types.' })
  leaveType!: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
