import { IsIn, IsISO8601, IsOptional, IsString, Matches } from 'class-validator';

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;

export class RecordSalaryDto {
  @Matches(MONEY, { message: 'amount must be a positive number with at most two decimal places' })
  amount!: string;

  @IsOptional() @IsIn(['MONTHLY', 'DAILY', 'HOURLY']) basis?: 'MONTHLY' | 'DAILY' | 'HOURLY';

  @IsISO8601() effectiveFrom!: string;

  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() note?: string;
}

/** "Correct" on a salary row (UAT, 14 October 2026): its amount and basis, with why. */
export class CorrectSalaryDto {
  @Matches(MONEY, { message: 'amount must be a positive number with at most two decimal places' })
  amount!: string;

  @IsOptional() @IsIn(['MONTHLY', 'DAILY', 'HOURLY']) basis?: 'MONTHLY' | 'DAILY' | 'HOURLY';

  // Optional here so the service can say "Say why" rather than a validator's words.
  @IsOptional() @IsString() reason?: string;
}

/** "Delete" on a salary row added by mistake, with why. */
export class DeleteSalaryDto {
  @IsOptional() @IsString() reason?: string;
}
