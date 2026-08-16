import { IsDateString, IsOptional, IsString, Matches, MinLength, ValidateIf } from 'class-validator';
import { PatientIdentifierType } from '@prisma/client';

const NRIC_RE = /^\d{12}$/;

export class UpdatePatientDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @ValidateIf((dto: UpdatePatientDto) => dto.identifierValue !== undefined && dto.identifierType === PatientIdentifierType.NRIC)
  @Matches(NRIC_RE, { message: 'NRIC must be exactly 12 digits' })
  @IsOptional()
  @IsString()
  identifierValue?: string;

  @IsOptional()
  identifierType?: PatientIdentifierType;

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
