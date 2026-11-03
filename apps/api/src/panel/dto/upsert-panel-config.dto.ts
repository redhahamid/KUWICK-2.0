import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  PanelClaimFeeType,
  PanelFeeTreatment,
  PanelSubmissionMethod,
  PanelTermAnchor,
  PanelTermUnit,
  PanelType,
} from '@prisma/client';

/**
 * A panel's OPERATIONAL configuration — what the claim workspace needs to know
 * to tell a staff member what to do. Commercial terms (`limitAmount`,
 * `claimFeeType`, markups) stay on the existing panel-clinic endpoint, which
 * already owns them; this does not duplicate them.
 */
export class UpsertPanelConfigDto {
  /**
   * WHAT KIND OF BODY THIS PANEL IS — see `PanelType`.
   *
   * Lives here rather than on the commercial endpoint because it drives no
   * arithmetic: it groups this screen and decides which questions the setup
   * wizard asks. Omitted leaves it as it was; it cannot be cleared back to
   * unclassified, because a kind somebody took the trouble to record should
   * not be erasable by a form that simply did not send the field.
   */
  @IsOptional()
  @IsEnum(PanelType)
  panelType?: PanelType;

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

  // -------------------------------------------------------------------------
  // THE CONTRACT TERMS THE CLINIC'S WORKBOOK KEEPS IN PROSE.
  //
  // Every field below replaces a sentence in a spreadsheet cell — a payment
  // term written as "60 - 90 working days", a fee rule written as
  // "10.8% X TOTAL BILL", a re-claim deadline written as rule 5 of a procedure
  // typed above the data. See docs/PANEL_LEGACY_WORKFLOW_AUDIT.md §3, §4, §8.1.
  //
  // All are OPTIONAL and all default to NULL, which means "nobody has said".
  // Nothing here is ever inferred: an unset fee direction makes the receivable
  // unresolved rather than guessed.
  // -------------------------------------------------------------------------

  /**
   * HOW THE PANEL'S ADMIN FEE IS TREATED (G-1).
   *
   * WITHHELD_FROM_CLAIM — expected = claimed − fee. The default for existing
   *                       panels, per the owner's decision of 2026-08-31.
   * ADDED_TO_RECEIVABLE — expected = claimed + fee.
   * NO_FEE              — this panel charges nothing.
   * UNCONFIGURED        — the rule cannot be established; the fee is applied in
   *                       neither direction and the balance says so.
   *
   * Setting this writes a new EFFECTIVE-DATED term (see `feeEffectiveFrom`) and
   * re-stamps claims that have not been sent yet; claims already submitted keep
   * the treatment they were raised under.
   */
  @IsOptional()
  @IsEnum(PanelFeeTreatment)
  feeTreatment?: PanelFeeTreatment;

  /**
   * When the fee term below takes effect. Defaults to today.
   *
   * Owner requirement (2026-08-31): fee configuration is effective-dated so a
   * future contract change does not alter historical receivables. Correcting a
   * term that is already in force means re-recording it on the SAME date, which
   * replaces that version; agreeing new terms means a new date.
   */
  @IsOptional()
  @IsISO8601()
  feeEffectiveFrom?: string;

  /** The fee itself, versioned alongside its treatment. */
  @IsOptional()
  @IsEnum(PanelClaimFeeType)
  claimFeeType?: PanelClaimFeeType;

  @IsOptional()
  @Matches(/^\d{1,8}(\.\d{1,2})?$/)
  claimFeeValue?: string;

  /** Why these terms are what they are — the contract clause, or the evidence. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  feeTermNote?: string;

  /** The nominal payment term — the near edge of a range, or the whole term. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermDays?: number;

  /** The far edge of a range term ("60 - 90 DAYS" → 60 here, 90 there). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermMaxDays?: number;

  /** Calendar or working days. Four panels in the workbook state working days. */
  @IsOptional()
  @IsEnum(PanelTermUnit)
  paymentTermUnit?: PanelTermUnit;

  /** What the clock starts from. Two panels count from the INVOICE date. */
  @IsOptional()
  @IsEnum(PanelTermAnchor)
  paymentTermAnchor?: PanelTermAnchor;

  /** A TPA whose term is set by the employer behind each claim. */
  @IsOptional()
  @IsBoolean()
  paymentTermVariesByPayer?: boolean;

  /**
   * How long there is to re-claim a rejection, in days from the ORIGINAL
   * service date. The clinic's own rule is two months; miss it and the claim
   * is gone.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(730)
  resubmissionWindowDays?: number;
}
