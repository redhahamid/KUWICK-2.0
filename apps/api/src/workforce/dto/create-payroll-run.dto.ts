import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class CreatePayrollRunDto {
  /** "2026-08" or "2026-08-01" — the month being paid. */
  @Matches(/^\d{4}-\d{2}(-\d{2})?$/, { message: 'A payroll period is a month, as YYYY-MM.' })
  period!: string;

  /** Omit to run across every branch. */
  @IsOptional() @IsUUID() clinicId?: string;

  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
