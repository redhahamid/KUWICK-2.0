import { IsOptional, IsString, IsUUID } from 'class-validator';

export class DecideLeaveRequestDto {
  @IsUUID()
  approvedByStaffId!: string;

  @IsOptional()
  @IsString()
  rejectReason?: string;
}
