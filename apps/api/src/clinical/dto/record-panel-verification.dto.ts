import { IsEnum, IsIn, IsNumber, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';
import { PanelCopaymentType, PanelCoverageType, PanelVerificationStatus } from '@prisma/client';

// G4.5d3c-3b1a (D-092) — what the verifier saw on the panel's portal,
// captured for THIS visit. The benefit terms travel WITH the outcome:
// a VERIFIED result with no terms would leave the billing engine guessing,
// which is the exact state this schema exists to abolish.
export class RecordPanelVerificationDto {
  // Only the two outcomes a verifier can honestly report. PENDING is the
  // automatic starting state and OVERRIDDEN belongs to the override route.
  @IsIn([PanelVerificationStatus.VERIFIED, PanelVerificationStatus.FAILED])
  status!: 'VERIFIED' | 'FAILED';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  memberReference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  verificationReference?: string;

  // Required when VERIFIED (service-enforced); meaningless when FAILED.
  @IsOptional()
  @IsEnum(PanelCoverageType)
  coverageType?: PanelCoverageType;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  visitLimitAmount?: number;

  @IsOptional()
  @IsEnum(PanelCopaymentType)
  copaymentType?: PanelCopaymentType;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  copaymentValue?: number;
}
