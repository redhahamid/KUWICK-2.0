import { Type } from 'class-transformer';
import { IsArray, IsInt, IsNumber, IsOptional, IsUUID, Min, ValidateNested } from 'class-validator';

export class CreatePurchaseOrderLineDto {
  @IsUUID()
  itemId!: string;

  @IsOptional()
  @IsUUID()
  procurementRequestId?: string;

  @IsInt()
  @Min(1)
  orderedQuantity!: number;

  @IsNumber()
  @Min(0)
  unitCost!: number;
}

export class CreatePurchaseOrderDto {
  @IsUUID()
  clinicId!: string;

  @IsUUID()
  supplierId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseOrderLineDto)
  lines!: CreatePurchaseOrderLineDto[];
}
