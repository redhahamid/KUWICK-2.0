import { IsIn, IsInt, Max, Min } from 'class-validator';

/** When a payroll item is paid: a day of the month, in the payroll month (0) or the month after it (1). */
export class SetPayDateDto {
  @IsInt() @Min(1) @Max(31) payDay!: number;
  @IsInt() @IsIn([0, 1]) payMonthOffset!: number;
}
