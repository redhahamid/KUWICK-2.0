import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class CreatePayrollRunDto {
  /** "2026-08" or "2026-08-01" — the month being paid. */
  @Matches(/^\d{4}-\d{2}(-\d{2})?$/, { message: 'A payroll period is a month, as YYYY-MM.' })
  period!: string;

  /** Omit to run across every branch. */
  @IsOptional() @IsUUID() clinicId?: string;

  /**
   * THE EMPLOYING COMPANY THIS RUN FILES UNDER.
   *
   * Optional, and derived when omitted — but only where there is exactly one
   * answer. EPF, SOCSO, EIS and PCB are all submitted BY an entity, so a run
   * that spans two of them cannot be filed at all, and a clinic with one
   * company should never have to think about the concept.
   */
  @IsOptional() @IsUUID() legalEmployerId?: string;

  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
