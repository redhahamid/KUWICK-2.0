import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { NoteLanguage } from '@prisma/client';

// C0 (D-051) — an amendment is a NEW note linked to the signed original.
// The original is never mutated; a reason is mandatory.
export class AmendClinicalNoteDto {
  @IsString()
  @IsNotEmpty({ message: 'An amendment requires a reason' })
  amendmentReason!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsEnum(NoteLanguage)
  noteLanguage?: NoteLanguage;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  clinicalEntryAt?: Date;

  @IsOptional()
  @IsString()
  lateEntryReason?: string;
}
