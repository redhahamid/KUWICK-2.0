import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class CreateSlotCapacityConfigDto {
  @IsUUID()
  clinicId!: string;

  @IsUUID()
  staffId!: string;

  @IsUUID()
  serviceId!: string;

  @IsInt()
  @Min(1)
  slotLengthMinutes!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  dailyCapacity?: number;
}
