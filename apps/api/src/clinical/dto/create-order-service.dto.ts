import { IsOptional, IsString } from 'class-validator';

export class CreateOrderServiceDto {
  @IsString()
  visitId!: string;

  @IsString()
  serviceCatalogId!: string;

  @IsOptional()
  @IsString()
  instruction?: string;
}
