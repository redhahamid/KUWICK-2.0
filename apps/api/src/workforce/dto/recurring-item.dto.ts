import { IsISO8601, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;

/**
 * A recurring item is an amount a pay component carries every month for one
 * employee — a housing allowance, an advance being recovered — from a date,
 * until a date or until it is ended. The sign comes from the component: an
 * ADDITION is paid, a DEDUCTION is taken. The amount is always written as the
 * positive figure on the payslip.
 */
export class CreateRecurringItemDto {
  @IsString() @MaxLength(64) componentCode!: string;

  /** "housing", "phone" — what distinguishes two allowances. */
  @IsOptional() @IsString() @MaxLength(120) label?: string;

  @Matches(MONEY, { message: 'amount must be a positive number with at most two decimal places' })
  amount!: string;

  @IsISO8601() effectiveFrom!: string;
  @IsOptional() @IsISO8601() effectiveTo?: string;

  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class UpdateRecurringItemDto {
  @IsOptional() @IsString() @MaxLength(120) label?: string;

  @IsOptional()
  @Matches(MONEY, { message: 'amount must be a positive number with at most two decimal places' })
  amount?: string;

  /** Send null to reopen an item that was given an end date too early. */
  @IsOptional() effectiveTo?: string | null;

  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
