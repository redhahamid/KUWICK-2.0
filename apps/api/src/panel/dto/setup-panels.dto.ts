import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  PanelClaimFeeType,
  PanelFeeTreatment,
  PanelTermAnchor,
  PanelTermUnit,
  PanelType,
} from '@prisma/client';

/**
 * ONE PANEL, AS THE SETUP WIZARD HANDS IT OVER.
 *
 * Everything except the name is optional, and that is the wizard's whole
 * premise: a clinic that answers only "these are my panels" gets working
 * panels. An unanswered term is NULL and an unanswered fee is `UNCONFIGURED`,
 * both of which every panel screen already knows how to report and chase. A
 * wizard that demanded a payment term before it would save anything would be
 * answered with a guess, and a guessed term decides when a claim reads as
 * overdue.
 */
export class SetupPanelRowDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsEnum(PanelType)
  panelType?: PanelType;

  @IsOptional()
  @Matches(/^https?:\/\/.+/, { message: 'A portal URL must start with http:// or https://' })
  @MaxLength(500)
  portalUrl?: string;

  /** The nominal term. The richer shapes (range, working days, a different
      anchor) are set afterwards on the configuration screen — the wizard asks
      the one question most panels answer. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(400)
  paymentTermDays?: number;

  @IsOptional()
  @IsEnum(PanelTermUnit)
  paymentTermUnit?: PanelTermUnit;

  @IsOptional()
  @IsEnum(PanelTermAnchor)
  paymentTermAnchor?: PanelTermAnchor;

  /** Omitted means `UNCONFIGURED`: nobody has said, and no receivable on this
      panel will apply a fee in either direction until somebody does. */
  @IsOptional()
  @IsEnum(PanelFeeTreatment)
  feeTreatment?: PanelFeeTreatment;

  @IsOptional()
  @IsEnum(PanelClaimFeeType)
  claimFeeType?: PanelClaimFeeType;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  claimFeeValue?: number;
}

export class SetupPanelsDto {
  /**
   * Capped at 60. The largest real panel list seen is 29 sheets, and a request
   * carrying hundreds is a paste accident rather than a clinic's panel list —
   * better refused with a number than written.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => SetupPanelRowDto)
  panels!: SetupPanelRowDto[];
}
