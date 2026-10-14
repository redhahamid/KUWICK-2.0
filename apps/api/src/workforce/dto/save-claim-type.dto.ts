import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { CLAIM_CODE } from '../claim-types';

/** A clinic claim type (Section E). The code is set once, on creation. */
export class SaveClaimTypeDto {
  @IsOptional() @Matches(CLAIM_CODE, { message: 'The code is capital letters, digits or _, e.g. PARKING.' }) code?: string;
  @IsString() @MaxLength(60) name!: string;
  /** KM to price by the kilometre; null for a claim of an amount. */
  @IsOptional() @IsIn(['KM', null]) unit?: 'KM' | null;
  @IsOptional() @IsNumber() @Min(0) @Max(1000) ratePerUnit?: number | null;
  @IsOptional() @IsNumber() @Min(0) @Max(5000) dailyUnitCap?: number | null;
  @IsOptional() @IsBoolean() receiptRequired?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
}
