import { IsIn, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;

export const CLAIM_CATEGORIES = [
  'MEDICAL', 'TRAVEL', 'MEAL', 'TRAINING', 'EQUIPMENT', 'PROFESSIONAL_FEE', 'OTHER',
] as const;

/**
 * A claim HR enters for an employee — the same shape the portal sends for
 * oneself, plus who it is for. Mileage is priced from the kilometres at the
 * clinic's rate; the receipt is the employee's own file, uploaded first
 * through POST workforce/staff-files on their behalf.
 */
export class CreateStaffClaimDto {
  @IsUUID() staffId!: string;
  @IsOptional() @IsUUID() clinicId?: string;
  @IsIn(CLAIM_CATEGORIES) category!: (typeof CLAIM_CATEGORIES)[number];
  @Matches(MONEY, { message: 'amountClaimed must be a positive number with at most two decimal places' })
  amountClaimed!: string;
  @IsISO8601() claimDate!: string;
  @IsString() @Length(3, 500) description!: string;
  /** Mileage: the kilometres. The server prices them at the clinic's rate and ignores the amount sent. */
  @IsOptional() @IsNumber() @Min(0.1) @Max(5000) distanceKm?: number;
  /** The receipt, already stored as the employee's own file of kind RECEIPT. Required when the policy says so. */
  @IsOptional() @IsUUID() receiptFileId?: string;
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
