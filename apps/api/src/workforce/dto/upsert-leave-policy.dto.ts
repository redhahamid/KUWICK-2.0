import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { LeaveType } from '@prisma/client';

export class LeaveEntitlementDto {
  @IsEnum(LeaveType) leaveType!: LeaveType;

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

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LeaveEntitlementDto)
  entitlements?: LeaveEntitlementDto[];
}
