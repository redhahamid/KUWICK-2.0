import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateSubscriptionPlanDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Min(0)
  priceMyr!: number;

  @IsInt()
  @Min(1)
  durationDays!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxUsers?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxPatients?: number;

  // Omit for unlimited storage.
  @IsOptional()
  @IsInt()
  @Min(1)
  maxStorageMb?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
