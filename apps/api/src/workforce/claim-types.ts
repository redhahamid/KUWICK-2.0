import { BadRequestException } from '@nestjs/common';

/**
 * CLAIM TYPES ARE THE CLINIC'S (Section E, 14 October 2026).
 *
 * A claim stores a type CODE. The clinic names its types in Settings → Claims:
 * a type with a unit (KM) is priced by Kuwick at the rate per unit, never for
 * more units a day than the cap; any other type is a claim of an amount. Each
 * type says whether a receipt is needed. The defaults below are a starting
 * point only.
 */

export const CLAIM_CODE = /^[A-Z][A-Z0-9_]{1,29}$/;

export interface ClaimKind {
  code: string;
  name: string;
  unit: string | null;
  ratePerUnit: number | null;
  dailyUnitCap: number | null;
  receiptRequired: boolean;
  active: boolean;
}

/**
 * What a clinic starts with: the categories Kuwick has always had, plus
 * mileage priced per km. Receipts follow the clinic's existing switch, and the
 * mileage rate its existing rate, so nothing changes until the clinic edits.
 */
export function defaultClaimKinds(policy: { mileageRatePerKm: string; receiptRequired: boolean }): ClaimKind[] {
  const amount = (code: string, name: string): ClaimKind => ({
    code,
    name,
    unit: null,
    ratePerUnit: null,
    dailyUnitCap: null,
    receiptRequired: policy.receiptRequired,
    active: true,
  });
  return [
    { code: 'MILEAGE', name: 'Mileage', unit: 'KM', ratePerUnit: Number(policy.mileageRatePerKm), dailyUnitCap: null, receiptRequired: false, active: true },
    amount('TRAVEL', 'Travel (toll, parking, fares)'),
    amount('MEAL', 'Meal'),
    amount('MEDICAL', 'Medical'),
    amount('TRAINING', 'Training'),
    amount('EQUIPMENT', 'Equipment'),
    amount('PROFESSIONAL_FEE', 'Professional fee'),
    amount('OTHER', 'Other'),
  ];
}

/** The clinic's stored types, or the defaults when it has none yet. */
export function claimKinds(
  rows: { code: string; name: string; unit: string | null; ratePerUnit: unknown; dailyUnitCap: unknown; receiptRequired: boolean; active: boolean }[],
  policy: { mileageRatePerKm: string; receiptRequired: boolean },
): ClaimKind[] {
  if (rows.length === 0) return defaultClaimKinds(policy);
  const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));
  return rows.map((row) => ({
    code: row.code,
    name: row.name,
    unit: row.unit,
    ratePerUnit: num(row.ratePerUnit),
    dailyUnitCap: num(row.dailyUnitCap),
    receiptRequired: row.receiptRequired,
    active: row.active,
  }));
}

/** The type a claim is for, refused when the clinic has no such active type, and the units already claimed that day. */
export async function claimTypeFor(
  tx: {
    claimTypeSetting: { findMany: (args?: object) => Promise<Parameters<typeof claimKinds>[0]> };
    staffClaim: { findMany: (args: object) => Promise<{ distanceKm: unknown }[]> };
  },
  policy: { mileageRatePerKm: string; receiptRequired: boolean },
  claim: { staffId: string; code: string; claimDate: string },
): Promise<{ kind: ClaimKind; unitsAlreadyThatDay: number }> {
  const kind = claimKinds(await tx.claimTypeSetting.findMany(), policy).find((row) => row.code === claim.code && row.active);
  if (!kind) throw new BadRequestException("That is not one of the clinic's claim types.");
  if (!kind.unit || kind.dailyUnitCap === null) return { kind, unitsAlreadyThatDay: 0 };
  const sameDay = await tx.staffClaim.findMany({
    where: {
      staffId: claim.staffId,
      category: claim.code,
      claimDate: new Date(`${claim.claimDate.slice(0, 10)}T00:00:00.000Z`),
      status: { in: ['SUBMITTED', 'APPROVED'] },
    },
    select: { distanceKm: true },
  });
  return { kind, unitsAlreadyThatDay: sameDay.reduce((sum, row) => sum + Number(row.distanceKm ?? 0), 0) };
}
