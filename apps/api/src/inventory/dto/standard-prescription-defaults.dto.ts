import { IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { DurationUnit } from '@prisma/client';

/**
 * PHASE 1G (1F) — what a medicine's prescribing form opens with.
 *
 * Both `CreateItemDto` and `UpdateItemDto` extend this, so the seven fields
 * cannot exist on one and be silently dropped by the other's whitelist. That
 * asymmetry is not hypothetical: the global `ValidationPipe` runs with
 * `whitelist: true`, so a field declared on create and forgotten on update
 * does not error — it disappears, and the clinic's edit appears to save.
 *
 * EVERY FIELD IS NULLABLE ON PURPOSE. `null` is how a doctor says "no default
 * for this one", and it has to be distinguishable from "field not sent". The
 * service treats the KEY BEING PRESENT as the clinic taking ownership of the
 * row, whatever value it carries.
 */
export class StandardPrescriptionDefaultsDto {
  /** How many units per dose. 2, for "2 tablets". */
  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultDoseAmount?: number | null;

  /** 1B — a `DosageUnit` row belonging to this clinic. */
  @IsOptional()
  @IsUUID()
  defaultDoseUnitId?: string | null;

  /** 1A — a `PrescriptionFrequency` row belonging to this clinic. */
  @IsOptional()
  @IsUUID()
  defaultFrequencyId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  defaultDurationValue?: number | null;

  @IsOptional()
  @IsEnum(DurationUnit)
  defaultDurationUnit?: DurationUnit | null;

  /** What the dispensary hands over. Auto-computed on the form, editable. */
  @IsOptional()
  @IsInt()
  @Min(0)
  defaultQuantity?: number | null;

  /** 1C — a `ConsumptionMethodRef` row belonging to this clinic. */
  @IsOptional()
  @IsUUID()
  defaultConsumptionMethodId?: string | null;

  // `defaultsFromSeed` is deliberately absent. It marks a row the platform
  // seeder wrote, and it is the only thing standing between a clinic's
  // correction and the next seed run reverting it. The seeder sets it and the
  // service clears it; a client that could post it could make its own edits
  // look like platform defaults — and `whitelist: true` drops it here.
}

/**
 * The keys that make a write "the clinic's own".
 *
 * Exported because the service and its tests must agree on this list — a field
 * added to the DTO and missed here would save fine and then be quietly
 * overwritten by the next `seed:standard-rx` run, which is the one failure
 * mode this whole flag exists to prevent.
 */
export const STANDARD_PRESCRIPTION_KEYS = [
  'defaultDoseAmount',
  'defaultDoseUnitId',
  'defaultFrequencyId',
  'defaultDurationValue',
  'defaultDurationUnit',
  'defaultQuantity',
  'defaultConsumptionMethodId',
] as const;

export type StandardPrescriptionKey = (typeof STANDARD_PRESCRIPTION_KEYS)[number];

/** Did this payload touch the standard prescription at all? */
export function touchesStandardPrescription(dto: object): boolean {
  return STANDARD_PRESCRIPTION_KEYS.some((key) => key in dto);
}
