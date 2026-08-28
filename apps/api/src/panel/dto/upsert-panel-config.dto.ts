import { IsArray, IsBoolean, IsEmail, IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PanelSubmissionMethod } from '@prisma/client';

/**
 * A panel's OPERATIONAL configuration — what the claim workspace needs to know
 * to tell a staff member what to do. Commercial terms (`limitAmount`,
 * `claimFeeType`, markups) stay on the existing panel-clinic endpoint, which
 * already owns them; this does not duplicate them.
 */
export class UpsertPanelConfigDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  payerName?: string;

  @IsOptional()
  @Matches(/^https?:\/\/.+/, { message: 'A portal URL must start with http:// or https://' })
  @MaxLength(500)
  portalUrl?: string;

  @IsOptional()
  @IsEnum(PanelSubmissionMethod)
  submissionMethod?: PanelSubmissionMethod;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  documentRequirements?: string[];

  @IsOptional()
  @IsBoolean()
  requiresItemisation?: boolean;

  @IsOptional()
  @IsBoolean()
  resubmitAsNewClaim?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  claimNumberFormat?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  contactName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  contactPhone?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  accountReference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  /**
   * Whether this panel's share is subject to service tax. LEFT NULL means
   * nobody has decided, and the tax engine treats that as "do not tax" rather
   * than guessing — see finance/invoice-tax.ts.
   */
  @IsOptional()
  @IsBoolean()
  panelShareTaxable?: boolean;
}
