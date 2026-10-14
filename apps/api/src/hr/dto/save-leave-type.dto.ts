import { IsBoolean, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { LEAVE_CODE } from '../leave-types';

/** A clinic leave type (Section D). The code is set once, on creation. */
export class SaveLeaveTypeDto {
  @IsOptional() @Matches(LEAVE_CODE, { message: 'The code is capital letters, digits or _, e.g. STUDY.' }) code?: string;
  @IsString() @MaxLength(60) name!: string;
  @IsOptional() @IsBoolean() paid?: boolean;
  /** Null: no yearly limit is tracked. */
  @IsOptional() @IsNumber() @Min(0) @Max(365) daysPerYear?: number | null;
  @IsOptional() @IsBoolean() documentRequired?: boolean;
  /** Null: nothing carries into next year. */
  @IsOptional() @IsNumber() @Min(0) @Max(365) carryForwardCap?: number | null;
  @IsOptional() @IsBoolean() active?: boolean;
}
