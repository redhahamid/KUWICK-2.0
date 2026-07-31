import { IsNumber, IsOptional, IsPositive, IsUUID } from 'class-validator';

export class CreatePanelPriceOverrideDto {
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @IsOptional()
  @IsUUID()
  serviceCatalogId?: string;

  @IsNumber()
  @IsPositive()
  overridePrice!: number;
}
