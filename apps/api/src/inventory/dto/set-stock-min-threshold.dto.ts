import { IsInt, IsUUID, Min } from 'class-validator';

export class SetStockMinThresholdDto {
  @IsUUID()
  clinicId!: string;

  @IsUUID()
  itemId!: string;

  @IsInt()
  @Min(0)
  minThreshold!: number;
}
