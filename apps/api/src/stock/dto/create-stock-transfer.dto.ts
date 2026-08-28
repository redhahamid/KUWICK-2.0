import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class StockTransferLineDto {
  @IsUUID()
  itemId!: string;

  /** STOCK UNITS. A transfer of zero is not a transfer. */
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreateStockTransferDto {
  @IsUUID()
  fromClinicId!: string;

  @IsUUID()
  toClinicId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  /**
   * Marks that this physical movement has a SEPARATE accounting settlement
   * between two companies. It does not create that document — physical
   * movement and financial settlement are different events (owner brief §3E).
   */
  @IsOptional()
  @IsBoolean()
  interCompany?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  interCompanyReference?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StockTransferLineDto)
  lines!: StockTransferLineDto[];
}
