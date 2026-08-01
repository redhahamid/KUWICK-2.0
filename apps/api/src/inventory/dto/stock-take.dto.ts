import { ArrayMinSize, IsArray, IsInt, IsOptional, IsUUID, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class StockTakeCountDto {
  @IsUUID()
  itemId!: string;

  @IsInt()
  @Min(0)
  countedQuantity!: number;
}

export class StockTakeDto {
  @IsUUID()
  clinicId!: string;

  @IsOptional()
  @IsUUID()
  countedByStaffId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StockTakeCountDto)
  counts!: StockTakeCountDto[];
}
