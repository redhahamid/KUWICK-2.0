import { LEAVE_CODE } from '../../hr/leave-types';
import { CLAIM_CODE } from '../../workforce/claim-types';
import { IsBoolean, IsDateString, IsISO8601, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

/**
 * NOTHING HERE TAKES A `staffId`.
 *
 * That is the whole security model of this module, expressed in the types: a
 * self-service route acts on the person holding the token and there is no
 * field through which it could be asked to act on somebody else. An employee
 * cannot read another employee's payslip because there is nowhere to put their
 * id, not because a check remembered to run.
 */

export class ClockSelfDto {
  /** Which branch they are at, when they work at more than one. */
  @IsOptional() @IsUUID() clinicId?: string;
  /** Where the phone said it was. Both or neither. */
  @IsOptional() @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) lng?: number;
  /** The selfie, uploaded first as a staff file of kind SELFIE. */
  @IsOptional() @IsUUID() proofFileId?: string;
  /** The code scanned from the branch kiosk (UAT, 14 October 2026). */
  @IsOptional() @IsString() @MaxLength(200) qr?: string;
}

/** The person's own kiosk PIN: 4 to 6 digits. */
export class SetAttendancePinDto {
  @Matches(/^\d{4,6}$/, { message: 'The PIN is 4 to 6 digits.' }) pin!: string;
}

export class RequestAttendanceCorrectionDto {
  @IsUUID() attendanceRecordId!: string;
  /** What the clock-in should have been. Omit to leave that end alone. */
  @IsOptional() @IsISO8601() requestedClockInAt?: string;
  @IsOptional() @IsISO8601() requestedClockOutAt?: string;
  /** Required, and long enough to decide on. "Please fix" is not a reason. */
  @Length(5, 500) reason!: string;
}

export class RequestLeaveDto {
  /**
   * One of the clinic's leave types, by code (Section D). The service checks
   * it is an active type; an unpaid type reaches payroll as a deduction.
   */
  @Matches(LEAVE_CODE, { message: "Choose one of the clinic's leave types." }) leaveType!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Start date must be YYYY-MM-DD.' }) startDate!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'End date must be YYYY-MM-DD.' }) endDate!: string;
  @IsOptional() @Length(3, 500) reason?: string;
  /** A half day is still a leave request; the flag is what makes it half. */
  @IsOptional() @IsBoolean() halfDay?: boolean;
  /** The MC, uploaded first as a staff file of kind MEDICAL_CERTIFICATE. Required when the policy says so. */
  @IsOptional() @IsUUID() attachmentFileId?: string;
}

export class SubmitClaimDto {
  /** One of the clinic's claim types, by code (Section E). */
  @Matches(CLAIM_CODE, { message: "Choose one of the clinic's claim types." }) category!: string;
  /** Decimal string, matching every other money field in this API. */
  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'Amount must be a number like 45.50.' }) amountClaimed!: string;
  @IsDateString() claimDate!: string;
  @Length(3, 500) description!: string;
  @IsOptional() @IsUUID() clinicId?: string;
  /** Mileage: the kilometres. The server prices them at the clinic's rate and ignores the amount sent. */
  @IsOptional() @IsNumber() @Min(0.1) @Max(5000) distanceKm?: number;
  /** The receipt, uploaded first as a staff file of kind RECEIPT. Required when the policy says so. */
  @IsOptional() @IsUUID() receiptFileId?: string;
}

export class AttachReceiptDto {
  /** A receipt already uploaded as a staff file. With it, the metadata below is read from the file. */
  @IsOptional() @IsUUID() fileId?: string;
  @ValidateIf((o) => !o.fileId) @Length(1, 200) fileName!: string;
  /** Where the file was stored. The upload itself is the storage layer's job. */
  @ValidateIf((o) => !o.fileId) @Length(1, 500) filePath!: string;
  @ValidateIf((o) => !o.fileId) @Length(1, 100) mimeType!: string;
  /**
   * Decorated, not merely typed. The validation pipe runs with `whitelist`,
   * which strips any property no decorator claims — an undecorated field is
   * silently dropped and then arrives at the database as undefined.
   *
   * 15MB is a phone photograph of a receipt with room to spare.
   */
  @ValidateIf((o) => !o.fileId) @IsInt() @Min(1) @Max(15 * 1024 * 1024) fileSize!: number;
}

/** My own contact details (testing, 15 October 2026). Blank clears a field. */
export class UpdateMyContactDto {
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(160) email?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsString() @MaxLength(10) postcode?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MaxLength(80) state?: string;
  @IsOptional() @IsString() @MaxLength(120) emergencyContactName?: string;
  @IsOptional() @IsString() @MaxLength(40) emergencyContactPhone?: string;
  @IsOptional() @IsString() @MaxLength(60) emergencyContactRelation?: string;
}

/** A new bank account, for HR to check and approve. */
export class RequestBankChangeDto {
  @IsString() @Length(2, 80) bankName!: string;
  @Matches(/^[0-9 -]{6,30}$/, { message: 'The account number is digits only, 6 to 30 of them.' }) bankAccountNo!: string;
  @IsString() @Length(2, 120) bankAccountName!: string;
  /** A photo of the statement header or card, uploaded first as kind BANK_PROOF. */
  @IsUUID() proofFileId!: string;
}
