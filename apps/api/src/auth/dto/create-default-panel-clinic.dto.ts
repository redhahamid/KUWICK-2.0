import { IsBoolean, IsOptional, IsString, IsUrl, MinLength } from 'class-validator';

export class CreateDefaultPanelClinicDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  url?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
