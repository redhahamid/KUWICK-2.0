import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class QuickAddStockDto {
  @IsUUID()
  clinicId!: string;

  @IsUUID()
  itemId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @IsOptional()
  @IsString()
  batchNumber?: string;

  @IsOptional()
  @IsUUID()
  addedByStaffId?: string;
}
