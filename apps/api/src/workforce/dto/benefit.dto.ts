import { IsInt, IsISO8601, IsOptional, IsString, Length, Matches, Max, Min, ValidateIf } from 'class-validator';

const MONEY = /^\d{1,8}(\.\d{1,2})?$/;

/** The clinic's medical benefit rules (Section F). */
export class SaveBenefitPolicyDto {
  @IsOptional() @Matches(MONEY, { message: 'Enter the yearly limit in ringgit, e.g. 1000.' }) yearlyLimit?: string;
  /** Null: the joining month never counts. */
  @IsOptional() @ValidateIf((o) => o.joiningMonthCutoffDay !== null) @IsInt() @Min(1) @Max(31) joiningMonthCutoffDay?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(100) alertBelowPercent?: number;
}

/** One use of the benefit, entered by hand. */
export class BenefitUsageDto {
  @IsISO8601() usedAt!: string;
  @Matches(MONEY, { message: 'Enter the amount in ringgit, e.g. 45.50.' }) amount!: string;
  @IsString() @Length(3, 300) notes!: string;
}
