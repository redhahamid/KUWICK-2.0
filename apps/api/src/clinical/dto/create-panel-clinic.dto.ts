import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { PanelClaimFeeType } from '@prisma/client';

export class CreatePanelClinicDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  limitAmount?: number;

  // D-041 — the panel's payment term in days; drives per-panel overdue
  // judgement in the claim listing and aging views.
  @IsOptional()
  @IsInt()
  @Min(1)
  paymentTermDays?: number;

  // D-041 (owner refinement) — per-panel claim fee: % of the claimed
  // amount or a flat RM value; omit both for panels with no fee (AIA).
  @IsOptional()
  @IsEnum(PanelClaimFeeType)
  claimFeeType?: PanelClaimFeeType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  claimFeeValue?: number;
}

export class UpdatePanelClinicDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  limitAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  paymentTermDays?: number;

  @IsOptional()
  @IsEnum(PanelClaimFeeType)
  claimFeeType?: PanelClaimFeeType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  claimFeeValue?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
