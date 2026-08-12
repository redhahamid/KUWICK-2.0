import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PatientAlertType } from '@prisma/client';

// A2 — recording a standing fact about a patient. The label is short on
// purpose: it renders as a header CHIP, and a paragraph-length chip is a
// note, which is what `note` is for.
export class CreatePatientAlertDto {
  @IsEnum(PatientAlertType)
  type!: PatientAlertType;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  label!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
