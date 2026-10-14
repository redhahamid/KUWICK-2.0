import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { LEAVE_CODE } from '../../hr/leave-types';

export class LeaveEntitlementDto {
  @Matches(LEAVE_CODE, { message: 'Leave type is a code, e.g. ANNUAL.' }) leaveType!: string;

  /** Days per benefit year. Zero is legitimate — unpaid leave has no allowance. */
  @IsNumber() @Min(0) @Max(365) daysPerYear!: number;

  @IsOptional() @IsBoolean() paid?: boolean;
  @IsOptional() @IsBoolean() requiresAttachment?: boolean;
}

export class UpsertLeavePolicyDto {
  @IsOptional() @IsUUID() id?: string;
  @IsString() @MaxLength(80) name!: string;
  @IsOptional() @IsInt() @Min(0) @Max(365) carryForwardDays?: number;
  @IsOptional() @IsBoolean() proRateOnJoin?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;

  /**
   * WHETHER UNTAKEN ANNUAL LEAVE IS PAID OUT WHEN SOMEBODY LEAVES.
   *
   * Section 60E(3) says it is owed, and says so of a contract ended by EITHER
   * party, so a resignation counts. Default true, because that is what the Act
   * says. A clinic may still choose not to — and Kuwick stores that choice
   * rather than refusing it, in the same shape as a below-Act overtime
   * multiplier: the tick and the reason below are what the service demands
   * before it will save the off position.
   */
  @IsOptional() @IsBoolean() payUntakenLeaveOnExit?: boolean;
  @IsOptional() @IsBoolean() notPayingAcknowledged?: boolean;
  @IsOptional() @IsString() @Length(4, 500) notPayingReason?: string | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LeaveEntitlementDto)
  entitlements?: LeaveEntitlementDto[];
}
