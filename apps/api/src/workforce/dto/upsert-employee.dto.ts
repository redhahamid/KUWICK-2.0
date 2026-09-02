import { IsBoolean, IsEnum, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { EmploymentStatus, EmploymentType } from '@prisma/client';

const MONEY = /^\d{1,10}(\.\d{1,2})?$/;

export class UpsertEmployeeDto {
  @IsOptional() @IsString() @MaxLength(40) employeeNo?: string;
  @IsOptional() @IsString() @MaxLength(160) legalName?: string;
  @IsOptional() @IsString() @MaxLength(20) identifierType?: string;
  @IsOptional() @IsString() @MaxLength(40) identifierValue?: string;
  @IsOptional() @IsISO8601() dateOfBirth?: string;
  @IsOptional() @IsString() @MaxLength(20) gender?: string;
  @IsOptional() @IsString() @MaxLength(60) nationality?: string;
  @IsOptional() @IsString() @MaxLength(30) maritalStatus?: string;

  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(160) email?: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @IsString() @MaxLength(120) emergencyContactName?: string;
  @IsOptional() @IsString() @MaxLength(40) emergencyContactPhone?: string;
  @IsOptional() @IsString() @MaxLength(60) emergencyContactRelation?: string;

  @IsOptional() @IsEnum(EmploymentType) employmentType?: EmploymentType;
  @IsOptional() @IsEnum(EmploymentStatus) employmentStatus?: EmploymentStatus;
  @IsOptional() @IsString() @MaxLength(80) department?: string;
  @IsOptional() @IsString() @MaxLength(80) position?: string;
  @IsOptional() @IsUUID() managerStaffId?: string;
  @IsOptional() @IsISO8601() startDate?: string;
  @IsOptional() @IsISO8601() confirmedDate?: string;
  @IsOptional() @IsISO8601() endDate?: string;
  @IsOptional() @IsString() @MaxLength(300) endReason?: string;

  /**
   * PAY AND BANK DETAILS. Accepted here so one form saves one person, but the
   * SERVICE drops them unless the actor also holds payroll access — an HR clerk
   * maintaining records must not be able to change somebody's salary by
   * including it in the same submission.
   */
  /**
   * LEGACY, AND REFUSED. Kept on the DTO so a caller that still sends it gets a
   * sentence telling them where salary goes, rather than a validation error
   * that reads as "this field does not exist".
   */
  @IsOptional() @Matches(MONEY) basicSalary?: string;
  @IsOptional() @Matches(MONEY) hourlyRate?: string;
  @IsOptional() @IsString() @MaxLength(80) bankName?: string;
  @IsOptional() @IsString() @MaxLength(40) bankAccountNo?: string;
  @IsOptional() @IsString() @MaxLength(120) bankAccountName?: string;

  @IsOptional() @IsString() @MaxLength(40) epfNumber?: string;
  @IsOptional() @IsString() @MaxLength(40) socsoNumber?: string;
  @IsOptional() @IsString() @MaxLength(40) taxNumber?: string;
  @IsOptional() @IsString() @MaxLength(20) taxCategory?: string;
  /**
   * Which limb of the EPF Third Schedule applies. Required before EPF can be
   * calculated for anybody: Parts C and E both cover people aged 60 and over,
   * at 6%/5.5% and 4%/0%, and only citizenship separates them.
   */
  @IsOptional()
  @IsIn(['MALAYSIAN_CITIZEN', 'PERMANENT_RESIDENT', 'NON_CITIZEN_ELECTED_PRE_1998', 'NON_CITIZEN'])
  epfMembership?: 'MALAYSIAN_CITIZEN' | 'PERMANENT_RESIDENT' | 'NON_CITIZEN_ELECTED_PRE_1998' | 'NON_CITIZEN';
  @IsOptional() @IsBoolean() epfApplicable?: boolean;
  @IsOptional() @IsBoolean() socsoApplicable?: boolean;
  @IsOptional() @IsBoolean() eisApplicable?: boolean;
  @IsOptional() @IsBoolean() pcbApplicable?: boolean;

  /**
   * THE MTD TAX PROFILE. Residence chooses between a flat 30% and the
   * progressive table; category chooses which deductions apply. Neither is
   * derivable from anything else on this record, so PCB refuses to compute
   * until both are recorded.
   */
  @IsOptional() @IsIn(['RESIDENT', 'NON_RESIDENT']) taxResidence?: 'RESIDENT' | 'NON_RESIDENT';
  @IsOptional()
  @IsIn(['CATEGORY_1', 'CATEGORY_2', 'CATEGORY_3'])
  pcbCategory?: 'CATEGORY_1' | 'CATEGORY_2' | 'CATEGORY_3';
  @IsOptional() @IsInt() @Min(0) @Max(20) qualifyingChildren?: number;
  @IsOptional() @IsBoolean() disabledSelf?: boolean;
  @IsOptional() @IsBoolean() disabledSpouse?: boolean;

  @IsOptional() @IsUUID() leavePolicyId?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
