import { IsEnum, IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { AttendanceStatus } from '@prisma/client';

export class CorrectAttendanceDto {
  @IsOptional() @IsISO8601() clockInAt?: string;
  @IsOptional() @IsISO8601() clockOutAt?: string;
  @IsOptional() @IsEnum(AttendanceStatus) status?: AttendanceStatus;

  @IsString()
  @MinLength(5, { message: 'Say why this attendance record is being corrected.' })
  @MaxLength(500)
  reason!: string;
}
