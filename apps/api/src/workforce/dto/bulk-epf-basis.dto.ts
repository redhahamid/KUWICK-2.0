import { IsBoolean, IsIn, IsISO8601, IsOptional, IsString, Length } from 'class-validator';

/**
 * ONE EPF BASIS FOR EVERY EMPLOYEE OF A BRANCH, from a date (UAT, 10 October
 * 2026). Each person gets their own dated record, exactly as if it were
 * recorded on their page; `commit` absent shows who would change.
 */
export class BulkEpfBasisDto {
  @IsString() clinicId!: string;

  /** Basic salary only, or back to all EPF-liable pay. A selection of items is per person. */
  @IsIn(['BASIC_ONLY', 'ALL_APPLICABLE']) mode!: 'BASIC_ONLY' | 'ALL_APPLICABLE';

  @IsISO8601() effectiveFrom!: string;

  @IsString() @Length(3, 500) reason!: string;

  @IsOptional() @IsBoolean() commit?: boolean;
}
