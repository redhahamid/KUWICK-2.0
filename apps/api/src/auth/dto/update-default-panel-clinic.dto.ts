import { IsBoolean, IsEnum, IsOptional, IsString, IsUrl, MinLength } from 'class-validator';
import { PanelType } from '@prisma/client';

export class UpdateDefaultPanelClinicDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  url?: string;

  /** See `PanelType`. Omitted means unclassified, which is reported. */
  @IsOptional()
  @IsEnum(PanelType)
  panelType?: PanelType;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
