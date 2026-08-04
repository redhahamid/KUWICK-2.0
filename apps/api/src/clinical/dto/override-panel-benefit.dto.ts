import { IsEnum, IsNumber, IsOptional, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';
import { PanelCopaymentType, PanelCoverageType } from '@prisma/client';

// G4.5d3c-3b1a (D-092) — replacing the working benefit terms. The reason is
// MANDATORY: an override with no reason is indistinguishable from a mistake,
// and this row is the audit trail.
export class OverridePanelBenefitDto {
  @IsEnum(PanelCoverageType)
  coverageType!: PanelCoverageType;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  visitLimitAmount?: number;

  @IsEnum(PanelCopaymentType)
  copaymentType!: PanelCopaymentType;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  copaymentValue?: number;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
