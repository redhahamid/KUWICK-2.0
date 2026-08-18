import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class WeeklyDayDto {
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  /** "HH:MM" wall clock in the clinic's own timezone. */
  @IsString()
  startTime!: string;

  @IsString()
  endTime!: string;
}

/**
 * The doctor's whole week, in one call.
 *
 * Deliberately a REPLACE rather than a set of adds and deletes. The screen is
 * seven toggles and seven time ranges — a person reads it as one statement
 * ("Dr Lim works Monday to Friday, 9 to 5") and saves it as one. Reconciling
 * that into individual row operations in the browser would put the diff logic
 * on the side of the wire that cannot see what is already stored, and a failed
 * third request would leave a week half-changed.
 */
export class SetWeeklyAvailabilityDto {
  @IsString()
  staffId!: string;

  @IsString()
  clinicId!: string;

  /** Days NOT listed are days the doctor does not work. */
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => WeeklyDayDto)
  days!: WeeklyDayDto[];
}
