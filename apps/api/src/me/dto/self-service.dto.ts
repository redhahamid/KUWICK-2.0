import { LeaveType, StaffClaimCategory } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

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
   * The closed set the whole product shares — ANNUAL, MEDICAL, EMERGENCY,
   * UNPAID, OTHER. UNPAID is on the list because it is the one an employee
   * genuinely needs to be able to ask for, and it is also the one that reaches
   * payroll as a deduction; hiding it would mean unpaid leave could only ever
   * be entered on somebody's behalf.
   */
  @IsEnum(LeaveType) leaveType!: LeaveType;
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Start date must be YYYY-MM-DD.' }) startDate!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'End date must be YYYY-MM-DD.' }) endDate!: string;
  @IsOptional() @Length(3, 500) reason?: string;
  /** A half day is still a leave request; the flag is what makes it half. */
  @IsOptional() @IsBoolean() halfDay?: boolean;
}

export class SubmitClaimDto {
  @IsEnum(StaffClaimCategory) category!: StaffClaimCategory;
  /** Decimal string, matching every other money field in this API. */
  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'Amount must be a number like 45.50.' }) amountClaimed!: string;
  @IsDateString() claimDate!: string;
  @Length(3, 500) description!: string;
  @IsOptional() @IsUUID() clinicId?: string;
}

export class AttachReceiptDto {
  @Length(1, 200) fileName!: string;
  /** Where the file was stored. The upload itself is the storage layer's job. */
  @Length(1, 500) filePath!: string;
  @Length(1, 100) mimeType!: string;
  /**
   * Decorated, not merely typed. The validation pipe runs with `whitelist`,
   * which strips any property no decorator claims — an undecorated field is
   * silently dropped and then arrives at the database as undefined.
   *
   * 15MB is a phone photograph of a receipt with room to spare.
   */
  @IsInt() @Min(1) @Max(15 * 1024 * 1024) fileSize!: number;
}
