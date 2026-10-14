import { IsIn, IsOptional, Matches } from 'class-validator';

const MONEY = /^\d{1,8}(\.\d{1,2})?$/;

/** A doctor's own locum and night rates (Section C). Null clears one; absent keeps it. */
export class DoctorRatesDto {
  @IsOptional() @Matches(MONEY, { message: 'Enter the locum rate in ringgit, e.g. 45 or 45.50.' }) locumRate?: string | null;
  @IsOptional() @IsIn(['PER_SHIFT', 'PER_HOUR', null]) nightPayMode?: 'PER_SHIFT' | 'PER_HOUR' | null;
  @IsOptional() @Matches(MONEY, { message: 'Enter the night rate in ringgit, e.g. 350 or 35.' }) nightRate?: string | null;
}
