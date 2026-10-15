import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsNumber, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

/**
 * ONE ROW OF THE INTAKE, DELIBERATELY LENIENT. The shape is checked here so
 * the request parses; what each cell MEANS is checked row by row in
 * `employee-intake.ts`, which answers per row and per field rather than
 * refusing the whole batch over one cell. The global pipe strips anything
 * not declared, so every field the form or the grid sends is declared.
 */
export class IntakeSalaryDto {
  @IsOptional() @IsString() @MaxLength(20) amount?: string;
  @IsOptional() @IsString() @MaxLength(20) basis?: string;
  @IsOptional() @IsString() @MaxLength(10) effectiveFrom?: string;
}

export class IntakeStandingDto {
  @IsOptional() @IsString() @MaxLength(10) effectiveFrom?: string;
  @IsOptional() @IsString() @MaxLength(40) epfMembership?: string;
  @IsOptional() @IsString() @MaxLength(40) lindungParticipation?: string;
  @IsOptional() @IsString() @MaxLength(20) taxResidence?: string;
  @IsOptional() @IsString() @MaxLength(20) pcbCategory?: string;
  @IsOptional() @IsNumber() qualifyingChildren?: number;
  @IsOptional() @IsNumber() restDayOfWeek?: number | null;
  @IsOptional() @IsBoolean() restDayVaries?: boolean;
  @IsOptional() @IsBoolean() restDayFollowsRoster?: boolean;
  @IsOptional() @IsString() @MaxLength(40) overtimeContractPolicy?: string;
}

export class EmployeeIntakeRowDto {
  @IsOptional() @IsString() @MaxLength(160) fullName?: string;
  @IsOptional() @IsString() @MaxLength(40) role?: string;
  @IsOptional() @IsString() @MaxLength(60) clinicId?: string;
  @IsOptional() @IsString() @MaxLength(60) legalEmployerId?: string;
  @IsOptional() @IsString() @MaxLength(40) employeeNo?: string;
  /** The words a sheet used for the job; a name on the clinic's job title list is linked to that title. */
  @IsOptional() @IsString() @MaxLength(80) position?: string;
  @IsOptional() @IsString() @MaxLength(60) jobTitleId?: string;
  @IsOptional() @IsString() @MaxLength(80) department?: string;
  @IsOptional() @IsString() @MaxLength(20) employmentType?: string;
  @IsOptional() @IsString() @MaxLength(10) startDate?: string;
  /** Probation until: the day they are confirmed in post. */
  @IsOptional() @IsString() @MaxLength(10) confirmedDate?: string;
  @IsOptional() @IsNumber() workDaysPerWeek?: number;
  @IsOptional() @IsString() @MaxLength(20) identifierType?: string;
  @IsOptional() @IsString() @MaxLength(40) identifierValue?: string;
  @IsOptional() @IsString() @MaxLength(40) passportNumber?: string;
  @IsOptional() @IsString() @MaxLength(10) dateOfBirth?: string;
  @IsOptional() @IsString() @MaxLength(20) gender?: string;
  @IsOptional() @IsString() @MaxLength(60) nationality?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(160) email?: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @IsString() @MaxLength(10) postcode?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsString() @MaxLength(60) state?: string;
  @IsOptional() @IsString() @MaxLength(120) emergencyContactName?: string;
  @IsOptional() @IsString() @MaxLength(40) emergencyContactPhone?: string;
  @IsOptional() @IsString() @MaxLength(60) emergencyContactRelation?: string;
  @IsOptional() @IsString() @MaxLength(60) medicalRegistrationNo?: string;
  @IsOptional() @IsString() @MaxLength(160) loginEmail?: string;
  @IsOptional() @IsString() @MaxLength(200) loginPassword?: string;
  @IsOptional() @IsString() @MaxLength(80) bankName?: string;
  @IsOptional() @IsString() @MaxLength(40) bankAccountNo?: string;
  @IsOptional() @IsString() @MaxLength(40) epfNumber?: string;
  @IsOptional() @IsString() @MaxLength(40) socsoNumber?: string;
  @IsOptional() @IsString() @MaxLength(40) taxNumber?: string;
  @IsOptional() @ValidateNested() @Type(() => IntakeSalaryDto) salary?: IntakeSalaryDto;
  @IsOptional() @ValidateNested() @Type(() => IntakeStandingDto) standing?: IntakeStandingDto;
}

export class EmployeeIntakeDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => EmployeeIntakeRowDto)
  rows!: EmployeeIntakeRowDto[];
  /** False, or absent, checks and writes nothing. True writes only when every row is clean. */
  @IsOptional() @IsBoolean() commit?: boolean;
}
