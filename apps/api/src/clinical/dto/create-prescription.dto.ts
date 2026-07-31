import { IsEnum, IsInt, IsNumber, IsOptional, IsPositive, IsString, Min } from 'class-validator';
import { DosageCalcMethod } from '@prisma/client';

export class CreatePrescriptionDto {
  @IsString()
  visitId!: string;

  @IsString()
  itemId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsString()
  frequency!: string;

  @IsInt()
  @Min(1)
  durationDays!: number;

  @IsOptional()
  @IsString()
  indication?: string;

  @IsOptional()
  @IsString()
  remark?: string;

  // Calculator audit trail (docs/DECISIONS.md D-028). WEIGHT_BASED is
  // recomputed server-side from calcWeightKg/calcDoseRateMgKg — `amount`
  // above is only trusted as submitted for AGE_BASED (validated against
  // the item's configured brackets) or MANUAL/undefined (doctor typed it).
  @IsOptional()
  @IsEnum(DosageCalcMethod)
  calcMethod?: DosageCalcMethod;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  calcWeightKg?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  calcDoseRateMgKg?: number;
}
