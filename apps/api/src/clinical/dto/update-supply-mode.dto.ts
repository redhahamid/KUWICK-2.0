import { IsEnum } from 'class-validator';
import { PrescriptionSupplyMode } from '@prisma/client';

// G4.5d3c-3a1 (D-091) — changing the supply intent is the ONLY thing this
// route can do. Required, not optional: an update that says nothing has no
// meaning, and NULL is a state a doctor resolves, never one they select.
export class UpdateSupplyModeDto {
  @IsEnum(PrescriptionSupplyMode)
  supplyMode!: PrescriptionSupplyMode;
}
