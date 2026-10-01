import { IsBoolean, IsEnum, IsNumber, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
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
  @IsOptional() @IsString() @MaxLength(10) postcode?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MaxLength(60) state?: string;
  /** A non-citizen's passport, beside the identity document rather than instead of it. Write-only, like the IC. */
  @IsOptional() @IsString() @MaxLength(40) passportNumber?: string;
  @IsOptional() @IsString() @MaxLength(120) emergencyContactName?: string;
  @IsOptional() @IsString() @MaxLength(40) emergencyContactPhone?: string;
  @IsOptional() @IsString() @MaxLength(60) emergencyContactRelation?: string;

  @IsOptional() @IsEnum(EmploymentType) employmentType?: EmploymentType;
  @IsOptional() @IsEnum(EmploymentStatus) employmentStatus?: EmploymentStatus;
  @IsOptional() @IsString() @MaxLength(80) department?: string;
  @IsOptional() @IsString() @MaxLength(80) position?: string;
  /** The clinic's own job title the position came from; the service copies its name into `position`. */
  @IsOptional() @IsUUID() jobTitleId?: string;
  /** 5, 5.5 or 6 — the days a week they work. Recorded and shown; the ordinary-rate divisor is the rule set's. */
  @IsOptional() @IsNumber() @Min(1) @Max(7) workDaysPerWeek?: number;
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
   * FROM HERE DOWN: STATUTORY CLASSIFICATION, LEGACY AND REFUSED.
   *
   * These now live on `employee_statutory_classifications`, dated, because
   * editing one of them used to change what EVERY unapproved period computed —
   * recording a permanent residence in September repriced March.
   *
   * They stay DECLARED on this DTO for the same reason `basicSalary` does: the
   * global pipe whitelists, so removing them would silently DROP a caller's EPF
   * Part and answer 200. Declared, they reach the service and get a sentence
   * saying where classification goes.
   *
   * Which limb of the EPF Third Schedule applies. Parts C and E both cover
   * people aged 60 and over, at 6%/5.5% and 4%/0%, and only citizenship
   * separates them.
   */
  @IsOptional()
  @IsIn(['MALAYSIAN_CITIZEN', 'PERMANENT_RESIDENT', 'NON_CITIZEN_ELECTED_PRE_1998', 'NON_CITIZEN'])
  epfMembership?: 'MALAYSIAN_CITIZEN' | 'PERMANENT_RESIDENT' | 'NON_CITIZEN_ELECTED_PRE_1998' | 'NON_CITIZEN';
  /** An election under Borang KWSP 17A. Anything but 11 is refused downstream. */
  @IsOptional() @IsNumber() @Min(0) @Max(30) epfEmployeeRate?: number;
  @IsOptional() @IsBoolean() epfApplicable?: boolean;
  @IsOptional() @IsBoolean() socsoApplicable?: boolean;
  /**
   * LINDUNG 24 JAM (SKBBK) participation — voluntary for locals, mandatory for
   * foreign workers. Recorded explicitly; never inferred from EPF membership,
   * tax residence or nationality, which answer different questions.
   */
  @IsOptional()
  @IsIn(['MANDATORY_FOREIGN_WORKER', 'ENROLLED', 'NOT_PARTICIPATING'])
  lindungParticipation?: 'MANDATORY_FOREIGN_WORKER' | 'ENROLLED' | 'NOT_PARTICIPATING';
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

  /**
   * s.59 — the rest day the employer designated, 0 Sunday to 6 Saturday.
   * Working one is paid in DAYS of ordinary rate under s.60(3), not as hours,
   * so it cannot be inferred from a roster or defaulted to Sunday.
   */
  @IsOptional() @IsInt() @Min(0) @Max(6) restDayOfWeek?: number;

  /**
   * What the employer undertook for extra hours when the Act does not reach
   * this employee — wages above the First Schedule's RM4,000 a month. Ignored
   * below that limit, where the Act's rates are a floor regardless.
   */
  @IsOptional()
  @IsIn(['PAY_AT_STATUTORY_RATES', 'NOT_PAID'])
  overtimeContractPolicy?: 'PAY_AT_STATUTORY_RATES' | 'NOT_PAID';

  @IsOptional() @IsUUID() leavePolicyId?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
