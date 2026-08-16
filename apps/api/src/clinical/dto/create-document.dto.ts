import { IsDateString, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { DocumentType } from '@prisma/client';

export class CreateDocumentDto {
  @IsUUID()
  visitId!: string;

  @IsEnum(DocumentType)
  type!: DocumentType;

  // Display name for CUSTOM documents — the template's name (D-040).
  @IsOptional()
  @IsString()
  title?: string;

  @IsString()
  @IsNotEmpty()
  content!: string;

  // Real doctor picker (not silently defaulted) — invoices/documents must
  // be staff-creatable for locum coverage per the owner's clinical flow.
  // Falls back to the visit's attending physician only if omitted.
  @IsOptional()
  @IsUUID()
  issuedByStaffId?: string;

  @IsOptional()
  @IsDateString()
  issuedDate?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  diagnosisText?: string;

  @IsOptional()
  @IsString()
  referredTo?: string;

  /**
   * Hours attended, for a TIME_SLIP.
   *
   * Bounded rather than free: a slip for 0 hours records nothing, and one for
   * more than a day is a typo — 24 is the ceiling because a slip covers a
   * single date, which is the whole reason it is not an MC.
   */
  @IsOptional()
  @IsNumber()
  @Min(0.25)
  @Max(24)
  hours?: number;
}
