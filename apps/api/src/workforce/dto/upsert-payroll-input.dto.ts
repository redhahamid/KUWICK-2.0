import { IsIn, IsISO8601, IsOptional, IsString, Length, Matches } from 'class-validator';

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;

export class UpsertPayrollInputDto {
  @IsString() staffId!: string;

  /** Any day in the month; normalised to the first. */
  @IsISO8601() period!: string;

  @IsString() @Length(1, 64) componentCode!: string;

  @Matches(MONEY, {
    message:
      'amount must be a positive number with at most two decimal places — the component decides whether it adds to or subtracts from pay',
  })
  amount!: string;

  @IsOptional() @IsString() @Length(1, 200) label?: string;

  /**
   * Recurring or additional. PCB treats the two differently, so this is stored
   * rather than inferred from where the row happens to sit.
   */
  @IsOptional() @IsIn(['RECURRING', 'ADDITIONAL']) kind?: 'RECURRING' | 'ADDITIONAL';

  /** Where the money was earned, when that is not the period it is paid in. */
  @IsOptional() @IsISO8601() earnedPeriod?: string;

  @IsOptional() @IsString() @Length(1, 500) reason?: string;
  @IsOptional() @IsString() @Length(1, 500) note?: string;
}
