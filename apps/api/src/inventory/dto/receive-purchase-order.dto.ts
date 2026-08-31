import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class ReceivePurchaseOrderLineDto {
  @IsUUID()
  purchaseOrderLineId!: string;

  @IsInt()
  @Min(1)
  quantityReceived!: number;

  @IsOptional()
  @IsString()
  batchNumber?: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unitCost?: number;
}

export class ReceivePurchaseOrderDto {
  @IsUUID()
  clinicId!: string;

  /**
   * Who took the delivery in. Optional for backward compatibility with the
   * existing receiving screen, but it is what puts a name on a price change —
   * "who changed our cost" was previously unanswerable from any source.
   */
  @IsOptional()
  @IsUUID()
  receivedByStaffId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceivePurchaseOrderLineDto)
  lines!: ReceivePurchaseOrderLineDto[];
}
