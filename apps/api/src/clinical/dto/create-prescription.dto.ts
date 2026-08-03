import { IsEnum, IsInt, IsNumber, IsOptional, IsPositive, IsString, Min } from 'class-validator';
import { DosageCalcMethod, PrescriptionSupplyMode } from '@prisma/client';

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

  // G4.5d3c-3a1 (D-091) — the SUPPLY INTENT, submitted explicitly by the
  // prescribing UI (which visibly defaults to ONSITE_DISPENSE). Optional at
  // the DTO level deliberately: there is no hidden server default, so a
  // caller that says nothing stores NULL — "not established" — rather than
  // being silently converted into a dispensing instruction.
  @IsOptional()
  @IsEnum(PrescriptionSupplyMode)
  supplyMode?: PrescriptionSupplyMode;

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
