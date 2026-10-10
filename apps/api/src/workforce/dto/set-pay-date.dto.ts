import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * When a payroll item is paid: the default day, in the run's month or the
 * month after it, and whether the run pays what was earned the month before.
 * Absent keeps it.
 */
export class SetPayDateDto {
  @IsInt() @Min(1) @Max(31) payDay!: number;
  @IsOptional() @IsBoolean() paidInArrears?: boolean;
  /** The date falls in the month after the run's: salary on the 1st of the following month. */
  @IsOptional() @IsBoolean() paidFollowingMonth?: boolean;
}
