import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreatePanelExclusionDto {
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @IsOptional()
  @IsUUID()
  serviceCatalogId?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
