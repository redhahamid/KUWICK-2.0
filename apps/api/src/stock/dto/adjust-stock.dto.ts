import { IsEnum, IsInt, IsOptional, IsString, IsUUID, MaxLength, MinLength, NotEquals } from 'class-validator';
import { StockAdjustmentReason } from '@prisma/client';

export class AdjustStockDto {
  @IsOptional()
  @IsUUID()
  clinicId?: string;

  @IsUUID()
  itemId!: string;

  /** Signed, in STOCK UNITS. Negative removes. Zero changes nothing and is refused. */
  @IsInt()
  @NotEquals(0)
  quantityDelta!: number;

  /**
   * The structured reason. Mandatory — this is the field that makes "how much
   * did we lose to expiry last quarter" a question with an answer, and free
   * text would not.
   */
  @IsEnum(StockAdjustmentReason)
  reason!: StockAdjustmentReason;

  @IsOptional()
  @IsUUID()
  batchId?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  notes?: string;
}
