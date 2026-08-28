import { IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';
import { LeaveType } from '@prisma/client';

export class AdjustLeaveBalanceDto {
  @IsUUID() staffId!: string;
  @IsEnum(LeaveType) leaveType!: LeaveType;
  @IsInt() @Min(2000) benefitYear!: number;

  @IsOptional() @IsNumber() @Min(0) entitledDays?: number;
  @IsOptional() @IsNumber() @Min(0) carriedInDays?: number;
  /** Signed: a negative adjustment removes days. */
  @IsOptional() @IsNumber() adjustmentDays?: number;

  @IsString()
  @MinLength(5, { message: 'Say why this leave balance is being adjusted.' })
  @MaxLength(500)
  reason!: string;
}
