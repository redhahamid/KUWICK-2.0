import { IsDateString, IsEnum, IsOptional, IsString, Matches, MinLength, ValidateIf } from 'class-validator';
import { PatientIdentifierType } from '@prisma/client';

// D-022 (docs/DECISIONS.md): basic format validation only, matching the
// live kuwick.com Add Patient form — NRIC gets a 12-digit shape check,
// Passport is accepted as free text. No checksum algorithm, since none was
// observed in the reference system.
const NRIC_RE = /^\d{12}$/;

export class CreatePatientDto {
  @IsEnum(PatientIdentifierType)
  identifierType!: PatientIdentifierType;

  @ValidateIf((dto: CreatePatientDto) => dto.identifierType === PatientIdentifierType.NRIC)
  @Matches(NRIC_RE, { message: 'NRIC must be exactly 12 digits' })
  @ValidateIf((dto: CreatePatientDto) => dto.identifierType === PatientIdentifierType.PASSPORT)
  @IsString()
  @MinLength(1)
  identifierValue!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsDateString()
  dob?: string;

  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @IsString()
  race?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  emergencyContactName?: string;

  @IsOptional()
  @IsString()
  emergencyContactPhone?: string;

}
