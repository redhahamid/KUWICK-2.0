import { IsIn, IsISO8601, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;

export const CLAIM_CATEGORIES = [
  'MEDICAL', 'TRAVEL', 'MEAL', 'TRAINING', 'EQUIPMENT', 'PROFESSIONAL_FEE', 'OTHER',
] as const;

export class CreateStaffClaimDto {
  @IsString() staffId!: string;
  @IsOptional() @IsString() clinicId?: string;
  @IsIn(CLAIM_CATEGORIES) category!: (typeof CLAIM_CATEGORIES)[number];
  @Matches(MONEY, { message: 'amountClaimed must be a positive number with at most two decimal places' })
  amountClaimed!: string;
  @IsISO8601() claimDate!: string;
  @IsString() @MaxLength(500) description!: string;
}

export class DecideStaffClaimDto {
  @IsIn(['APPROVED', 'REJECTED']) decision!: 'APPROVED' | 'REJECTED';

  /**
   * Required on approval. A part-approved claim is normal — the approver
   * decides what the clinic pays, and defaulting it to the claimed amount
   * would make approval a rubber stamp.
   */
  @IsOptional() @Matches(MONEY, { message: 'amountApproved must be a positive number with at most two decimal places' })
  amountApproved?: string;

  /**
   * WHERE THE MONEY COMES FROM. Required on approval and not changeable
   * afterwards: a claim that could be paid through both routes is a claim that
   * will eventually be paid through both.
   */
  @IsOptional() @IsIn(['PAYROLL', 'FINANCE']) paymentRoute?: 'PAYROLL' | 'FINANCE';

  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class SettleStaffClaimDto {
  @IsString() @MaxLength(120) financeReference!: string;
  @IsOptional() @IsISO8601() paidOn?: string;
}
