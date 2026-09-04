import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * OPENING YEAR-TO-DATE, for a clinic that starts using Kuwick in July.
 *
 * PCB, Form EA and every statutory annual figure are cumulative, so a mid-year
 * migration that starts from zero computes the rest of the year wrong — the
 * employee has already used their reliefs and already paid tax, and an engine
 * that does not know charges them again from scratch.
 *
 * Every figure here is a MONTH, not a running total. Accepting "the total so
 * far" would make the numbers impossible to check against the payslips they
 * came from, and impossible to correct one month of later.
 */
export class YtdOpeningMonthDto {
  @IsUUID() staffId!: string;

  @IsInt() @Min(2000) @Max(2100) taxYear!: number;
  @IsInt() @Min(1) @Max(12) month!: number;

  /** Gross for the month, in cents. */
  @IsInt() @Min(0) grossCents!: number;
  /** Bonus and other additional remuneration WITHIN that gross, in cents. */
  @IsInt() @Min(0) additionalRemunerationCents = 0;
  @IsInt() @Min(0) pcbCents = 0;
  @IsInt() @Min(0) cp38Cents = 0;
  @IsInt() @Min(0) zakatCents = 0;
  @IsInt() @Min(0) epfEmployeeCents = 0;
  @IsInt() @Min(0) epfEmployerCents = 0;
  @IsInt() @Min(0) socsoEmployeeCents = 0;
  @IsInt() @Min(0) socsoEmployerCents = 0;
  @IsInt() @Min(0) eisEmployeeCents = 0;
  @IsInt() @Min(0) eisEmployerCents = 0;
  /** LINDUNG 24 JAM withheld in the month, where the previous system took it. */
  @IsInt() @Min(0) lindungEmployeeCents = 0;
  /** LP the month applied — TP1 allowable deductions, feeding ∑LP. */
  @IsInt() @Min(0) deductionsCents = 0;
}

export class ImportYtdOpeningDto {
  /** Which employing entity these figures were paid under. */
  @IsUUID() legalEmployerId!: string;

  /**
   * Where the figures came from — the previous system, the payslips, an EA
   * form. Recorded on every row, because a year-to-date somebody typed in is
   * only as trustworthy as the thing they typed it from, and in twelve months
   * nobody will remember which.
   */
  @IsString() @MinLength(5) @MaxLength(500) source!: string;

  @IsOptional() @IsString() @MaxLength(2000) note?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => YtdOpeningMonthDto)
  months!: YtdOpeningMonthDto[];
}
