import { IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { NoteLanguage } from '@prisma/client';

export class UpsertClinicalNoteDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  bpSystolic?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  bpDiastolic?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  pulse?: number;

  @IsOptional()
  @IsNumber()
  temperature?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  spo2?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  respRate?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  painScore?: number;

  @IsOptional()
  @IsNumber()
  weight?: number;

  @IsOptional()
  @IsNumber()
  height?: number;

  @IsOptional()
  @IsNumber()
  headCircumference?: number;

  @IsOptional()
  @IsNumber()
  glucose?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsEnum(NoteLanguage)
  noteLanguage?: NoteLanguage;
}
