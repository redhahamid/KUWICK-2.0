import { IsDateString, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { PatientIdentifierType } from '@prisma/client';

export class CreatePatientDto {
  @IsEnum(PatientIdentifierType)
  identifierType!: PatientIdentifierType;

  // No NRIC checksum validation here — that's Clinical Operations (1a)
  // scope. This just requires a non-empty identifier value.
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
  address?: string;

  @IsOptional()
  @IsString()
  emergencyContact?: string;
}
