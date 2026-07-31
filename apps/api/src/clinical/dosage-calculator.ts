import { ItemAgeDosage } from '@prisma/client';

export interface WeightBasedDoseInput {
  weightKg: number;
  doseRateMgKg: number;
  concVolMl: number;
  strengthMg: number;
}

export interface WeightBasedDoseResult {
  targetDoseMg: number;
  volumeMl: number;
}

// Confirmed against the live kuwick.com Medications calculator
// (docs/DECISIONS.md D-028): Target Dose (mg) = Weight (kg) x Dose Rate
// (mg/kg); Volume (mL) = Target Dose (mg) x Concentration Volume (mL) /
// Strength (mg). Verified example: 10kg x 15mg/kg = 150mg;
// 150mg x 5mL / 457mg = 1.64mL.
export function calculateWeightBasedDose(input: WeightBasedDoseInput): WeightBasedDoseResult {
  const targetDoseMg = input.weightKg * input.doseRateMgKg;
  const volumeMl = (targetDoseMg * input.concVolMl) / input.strengthMg;
  return { targetDoseMg, volumeMl };
}

// Age-based dosing is a per-medicine bracket lookup, not a formula — the
// live reference product doesn't have this finished (owner-confirmed), so
// there's no persisted "which bracket was picked" audit field on
// Prescription yet. Bounds are inclusive on both ends (ageFromMonths,
// ageToMonths), matching the "2y-5y" / "5y-11y" style brackets the owner
// described.
export function findAgeBracket(brackets: ItemAgeDosage[], ageMonths: number): ItemAgeDosage | undefined {
  return brackets.find((bracket) => ageMonths >= bracket.ageFromMonths && ageMonths <= bracket.ageToMonths);
}
