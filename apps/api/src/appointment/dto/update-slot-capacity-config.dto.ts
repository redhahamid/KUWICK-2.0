import { IsInt, IsOptional, Min } from 'class-validator';

export class UpdateSlotCapacityConfigDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  slotLengthMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  dailyCapacity?: number;
}
