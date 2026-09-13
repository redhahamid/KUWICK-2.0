import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { AttendanceStatus } from '@prisma/client';

/**
 * One line of the day as the Fix drawer left it.
 *
 * `id` names a punch already on the record. Without it this is a punch being
 * added. `wrong` marks one as not what happened, which supersedes it and puts
 * nothing in its place — the day then says it is incomplete rather than
 * quietly reporting fewer hours.
 */
export class CorrectPunchDto {
  @IsOptional() @IsUUID() id?: string;
  @IsOptional() @IsISO8601() at?: string;
  @IsOptional() @IsIn(['IN', 'OUT']) kind?: 'IN' | 'OUT';
  @IsOptional() @IsBoolean() wrong?: boolean;
}

export class CorrectAttendanceDto {
  /**
   * The whole day, punch by punch. A clinic whose staff clock out at lunch and
   * back in has four of these, and two time fields cannot express it.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CorrectPunchDto)
  punches?: CorrectPunchDto[];

  /** The older two-field form: the day's two ends. Still accepted. */
  @IsOptional() @IsISO8601() clockInAt?: string;
  @IsOptional() @IsISO8601() clockOutAt?: string;
  @IsOptional() @IsEnum(AttendanceStatus) status?: AttendanceStatus;

  @IsString()
  @MinLength(5, { message: 'Say why this attendance record is being corrected.' })
  @MaxLength(500)
  reason!: string;
}
