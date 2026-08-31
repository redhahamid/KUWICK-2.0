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

  /**
   * THE PROMOTIONAL PRICE, when the supplier quoted one.
   *
   * The clinic's order queue carries "unit price" and "bonus price" side by
   * side and values the line at `MIN(unit, bonus)`, because that is what it
   * pays. Leaving this out means no promotion — NOT a promotion of zero.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  bonusUnitCost?: number;
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
