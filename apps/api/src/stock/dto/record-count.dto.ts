import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';

export class StockTakeCountDto {
  @IsUUID()
  lineId!: string;

  /** Zero is a real count: the shelf is empty. Negative is not. */
  @IsInt()
  @Min(0)
  quantity!: number;

  /** Loose units outside a full pack, so the counter does not divide on the shelf. */
  @IsOptional()
  @IsInt()
  @Min(0)
  looseUnits?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  varianceReason?: string;
}

export class RecordCountDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StockTakeCountDto)
  counts!: StockTakeCountDto[];
}
