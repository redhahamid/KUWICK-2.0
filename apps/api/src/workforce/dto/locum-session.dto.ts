import { IsIn, IsISO8601, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;
const HOURS = /^\d{1,4}(\.\d{1,2})?$/;

export class RecordLocumSessionDto {
  @IsString() staffId!: string;
  @IsString() clinicId!: string;
  @IsISO8601() sessionDate!: string;

  @IsOptional() @IsString() @MaxLength(120) label?: string;

  /** Hourly or flat — both are used. The service refuses a session with neither. */
  @IsOptional() @Matches(HOURS, { message: 'hours must be a positive number with at most two decimal places' })
  hours?: string;
  @IsOptional() @Matches(MONEY, { message: 'hourlyRate must be a positive number with at most two decimal places' })
  hourlyRate?: string;
  @IsOptional() @Matches(MONEY, { message: 'sessionFee must be a positive number with at most two decimal places' })
  sessionFee?: string;

  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class UpdateLocumSessionDto {
  @IsOptional() @IsISO8601() sessionDate?: string;
  @IsOptional() @IsString() @MaxLength(120) label?: string;
  @IsOptional() @Matches(HOURS) hours?: string;
  @IsOptional() @Matches(MONEY) hourlyRate?: string;
  @IsOptional() @Matches(MONEY) sessionFee?: string;
  @IsOptional() @IsIn(['PLANNED', 'COMPLETED', 'CANCELLED']) status?: 'PLANNED' | 'COMPLETED' | 'CANCELLED';
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class ApproveLocumSessionDto {
  /**
   * The amount actually agreed. Defaulting it to the computed figure would make
   * "approved" mean "nobody looked", which is the failure the approval step
   * exists to prevent.
   */
  @Matches(MONEY, { message: 'approvedAmount must be a positive number with at most two decimal places' })
  approvedAmount!: string;

  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class SettleLocumSessionDto {
  @IsString() @MaxLength(120) invoiceReference!: string;
  @IsOptional() @IsISO8601() paidOn?: string;
}
