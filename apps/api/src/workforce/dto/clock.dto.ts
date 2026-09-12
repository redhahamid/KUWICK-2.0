import { AttendanceSource } from '@prisma/client';
import { IsIn, IsISO8601, IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class ClockDto {
  @IsOptional() @IsUUID() staffId?: string;
  @IsOptional() @IsUUID() clinicId?: string;
  @IsOptional() @IsISO8601() at?: string;
  /** Where the phone said it was. Both or neither; judged against the branch's geofence. */
  @IsOptional() @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) lng?: number;
  /** A selfie already stored as the person's own staff file (kind SELFIE). Needs their consent on record. */
  @IsOptional() @IsUUID() proofFileId?: string;
  /** Where the punch came from. Clocking somebody else in is always MANUAL, whatever is sent. */
  @IsOptional() @IsIn(['PORTAL', 'QR', 'DEVICE', 'MANUAL']) source?: AttendanceSource;
}
