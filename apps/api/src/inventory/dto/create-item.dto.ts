import { IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateItemDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  unitOfMeasure?: string;

  @IsOptional()
  @IsString()
  doseDefault?: string;

  @IsOptional()
  @IsString()
  frequencyDefault?: string;

  @IsOptional()
  @IsString()
  durationDefault?: string;

  @IsOptional()
  @IsString()
  instruction?: string;

  @IsOptional()
  @IsString()
  indication?: string;

  @IsNumber()
  @Min(0)
  sellPrice!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  cost?: number;
}
