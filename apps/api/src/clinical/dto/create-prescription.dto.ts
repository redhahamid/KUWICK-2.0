import { IsEnum, IsInt, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Min } from 'class-validator';
import { DosageCalcMethod, DurationUnit, PrescriptionSupplyMode } from '@prisma/client';

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

  // ---- b1 PHASE A — the structured choices, as CATALOGUE IDS ---------------
  //
  // IDS ONLY. The patient-facing Malay text is looked up server-side and
  // copied onto the row; it is never accepted from a client. A caller that
  // could post `frequencyBm` alongside `frequency` could print a label
  // contradicting the prescription, and nothing downstream would catch it.
  //
  // All optional, because `frequency`/`unit` above still accept free text: the
  // Flow layout and Copy Rx write prescriptions without going through the new
  // dropdowns, and a required field here would break both. Where an id IS
  // given it wins, and the free-text value it resolves to is what gets stored.

  @IsOptional()
  @IsUUID()
  frequencyId?: string;

  @IsOptional()
  @IsUUID()
  doseUnitId?: string;

  @IsOptional()
  @IsUUID()
  consumptionMethodId?: string;

  /** A preset indication. Free text in `indication` remains allowed instead. */
  @IsOptional()
  @IsUUID()
  indicationId?: string;

  /**
   * The course as the doctor wrote it: "2" + "WEEK".
   *
   * `durationDays` above stays required and canonical. When this pair is sent
   * the server RECOMPUTES `durationDays` from it rather than trusting the
   * client's arithmetic — two opinions about how long a month is would be two
   * different courses for one prescription.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  durationValue?: number;

  @IsOptional()
  @IsEnum(DurationUnit)
  durationUnit?: DurationUnit;

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
