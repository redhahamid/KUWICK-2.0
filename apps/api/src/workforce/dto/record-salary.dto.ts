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
