import { IsEnum, IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { ServiceOrderType } from '@prisma/client';

export class CreateServiceDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsEnum(ServiceOrderType)
  orderType?: ServiceOrderType;

  @IsOptional()
  @IsString()
  category?: string;

  @IsInt()
  @Min(1)
  durationMinutesDefault!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;
}

export class UpdateServiceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsEnum(ServiceOrderType)
  orderType?: ServiceOrderType;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationMinutesDefault?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  active?: boolean;
}
