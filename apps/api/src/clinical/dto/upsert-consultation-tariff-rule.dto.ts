import { IsBoolean, IsEnum, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { VisitClassification } from '@prisma/client';

// G4.5d3c-3b2 (D-094) — a consultation tariff rule. Times are clinic-local
// "HH:MM", inclusive at both ends; startTime > endTime means the band crosses
// midnight. The rule selects the SERVICE; the pricing resolver prices it, so
// there is deliberately no price field here.
export class UpsertConsultationTariffRuleDto {
  @IsUUID()
  clinicId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsEnum(VisitClassification)
  classification!: VisitClassification;

  @IsString()
  @MaxLength(5)
  startTime!: string;

  @IsString()
  @MaxLength(5)
  endTime!: string;

  @IsUUID()
  serviceCatalogId!: string;

  @IsOptional()
  @IsISO8601()
  effectiveFrom?: string;

  @IsOptional()
  @IsISO8601()
  effectiveTo?: string;
}
