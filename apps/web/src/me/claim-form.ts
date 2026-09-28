/**
 * THE CLAIM FORM'S SHARED PIECES — what a person sends from the portal and
 * what HR keys for them from a paper receipt are the same claim, so the
 * types, the mileage arithmetic and the default rate live once, here.
 */
export const CLAIM_TYPES = [
  { value: 'MILEAGE', label: 'Mileage', category: 'TRAVEL' },
  { value: 'MEDICAL', label: 'Medical', category: 'MEDICAL' },
  { value: 'MEAL', label: 'Meals', category: 'MEAL' },
  { value: 'TRAVEL', label: 'Travel (fares, parking, tolls)', category: 'TRAVEL' },
  { value: 'TRAINING', label: 'Training', category: 'TRAINING' },
  { value: 'EQUIPMENT', label: 'Equipment', category: 'EQUIPMENT' },
  { value: 'PROFESSIONAL_FEE', label: 'Professional fee', category: 'PROFESSIONAL_FEE' },
  { value: 'OTHER', label: 'Other', category: 'OTHER' },
] as const;

export type ClaimTypeValue = (typeof CLAIM_TYPES)[number]['value'];

/**
 * [D] RM per kilometre comes from the clinic's claim policy (Settings ›
 * Claims, `ClaimPolicy.mileageRatePerKm`); the server prices the claim with
 * the same rate and freezes it on the row. This default only stands in
 * while the policy is still loading, and matches the policy's own default
 * (the mockup's 42 km at RM 25.20).
 */
export const DEFAULT_MILEAGE_RATE_RM = 0.6;

export function mileageAmount(km: number, ratePerKm: number = DEFAULT_MILEAGE_RATE_RM): number {
  return Math.round(km * ratePerKm * 100) / 100;
}
