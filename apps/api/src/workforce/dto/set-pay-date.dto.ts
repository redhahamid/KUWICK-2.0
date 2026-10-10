import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * When a payroll item is paid: the default day of the run's month, and
 * whether the run pays what was earned the month before. Absent keeps it.
 */
export class SetPayDateDto {
  @IsInt() @Min(1) @Max(31) payDay!: number;
  @IsOptional() @IsBoolean() paidInArrears?: boolean;
}
