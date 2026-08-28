import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';

export class ReceiveStockTransferLineDto {
  @IsUUID()
  lineId!: string;

  /** Zero is a legitimate answer: the line did not arrive. */
  @IsInt()
  @Min(0)
  quantityReceived!: number;

  /**
   * Required by the SERVICE whenever the count differs from what was sent —
   * not by this DTO, because whether it is required depends on a number the
   * client does not own.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  discrepancyReason?: string;
}

export class ReceiveStockTransferDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceiveStockTransferLineDto)
  lines!: ReceiveStockTransferLineDto[];
}
