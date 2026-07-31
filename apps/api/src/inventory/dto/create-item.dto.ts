import { IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateItemDto {
  @IsOptional()
  @IsString()
  code?: string;

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

  // "Conc. Vol (mL)" / "Strength (mg)" on the audited Edit Inventory
  // screen — e.g. 457mg per 5mL, feeds the weight-based dosage calculator
  // (docs/DECISIONS.md D-028). Only liquid/syrup medicines carry these.
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

  @IsNumber()
  @Min(0)
  sellPrice!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  cost?: number;
}
