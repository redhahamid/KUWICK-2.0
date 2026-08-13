import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { StandardPrescriptionDefaultsDto } from './standard-prescription-defaults.dto';

export class UpdateItemDto extends StandardPrescriptionDefaultsDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

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
  doseUnitDefault?: string;

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

  @IsOptional()
  @IsNumber()
  @Min(0)
  concVolMl?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  strengthMg?: number;

  @IsOptional()
  @IsString()
  consumptionMethod?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  defaultDispenseQuantity?: number;

  @IsOptional()
  @IsString()
  prescriptionReference?: string;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  sellPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  cost?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
