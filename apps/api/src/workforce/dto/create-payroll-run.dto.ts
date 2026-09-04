import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

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

  /**
   * WHAT KIND OF RUN THIS IS.
   *
   * `PayrollRunType` has existed since Stage 2 and NOTHING EVER SET IT: every
   * run in the system was REGULAR, and the duplicate check refused a second run
   * of any kind for the month, so a bonus paid off-cycle, a correction beside
   * an approved month and a leaver's final pay were all unreachable.
   *
   * The types are NOT interchangeable. An off-cycle bonus must not re-pay basic
   * salary, and a final payment is not a normal month — so this changes what is
   * computed, not merely what a run is labelled.
   */
  @IsOptional()
  @IsIn(['REGULAR', 'OFF_CYCLE_BONUS', 'CORRECTION', 'FINAL_PAY'])
  runType?: 'REGULAR' | 'OFF_CYCLE_BONUS' | 'CORRECTION' | 'FINAL_PAY';

  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
