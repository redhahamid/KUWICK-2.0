import { BadRequestException } from '@nestjs/common';
import type { ClaimKind } from './claim-types';

/**
 * ONE PRICE AND ONE RECEIPT RULE FOR A CLAIM, whoever keys it.
 *
 * The portal and HR's route both come here. Section E (14 October 2026): the
 * claim type decides. A type with a unit is priced units × rate, and units
 * past the daily cap are not paid; the claim says how many and why
 * (decision 9). Kilometres sent with a type that has no unit are priced at
 * the clinic's mileage rate, as before.
 */
export interface ClaimPolicyView {
  mileageRatePerKm: string;
  receiptRequired: boolean;
}

export interface PricedClaim {
  amountClaimed: string;
  distanceKm: number | null;
  mileageRate: string | null;
  /** What was not paid and why, or null. */
  unpaidNote: string | null;
}

export function priceClaim(
  input: { amountClaimed: string; distanceKm?: number | null },
  policy: ClaimPolicyView,
  kind: ClaimKind | null = null,
  /** Units of this type already claimed for the same day, which count towards the cap. */
  unitsAlreadyThatDay = 0,
): PricedClaim {
  const units = input.distanceKm ?? null;
  if (kind?.unit && units === null) {
    throw new BadRequestException(`${kind.name} is claimed by the ${kind.unit.toLowerCase()}. Enter how many.`);
  }
  if (units === null) {
    if (Number(input.amountClaimed) <= 0) throw new BadRequestException('A claim must be for more than nothing.');
    return { amountClaimed: input.amountClaimed, distanceKm: null, mileageRate: null, unpaidNote: null };
  }
  const rate = kind?.unit && kind.ratePerUnit !== null ? kind.ratePerUnit : Number(policy.mileageRatePerKm);
  const cap = kind?.unit ? kind.dailyUnitCap : null;
  // Paid up to the daily cap, never past it (decision 9).
  const paidUnits = cap === null ? units : Math.max(0, Math.min(units, cap - unitsAlreadyThatDay));
  const unit = (kind?.unit ?? 'KM').toLowerCase();
  const unpaidNote =
    paidUnits < units ? `${round1(units - paidUnits)} ${unit} over the ${cap} ${unit} daily cap ${units - paidUnits === 1 ? 'is' : 'are'} not paid.` : null;
  const amountClaimed = (Math.round(paidUnits * rate * 100) / 100).toFixed(2);
  if (Number(amountClaimed) <= 0) {
    throw new BadRequestException(unpaidNote ? `The daily cap of ${cap} ${unit} is already used for that day.` : 'A claim must be for more than nothing.');
  }
  return { amountClaimed, distanceKm: units, mileageRate: rate.toFixed(2), unpaidNote };
}

const round1 = (value: number) => Math.round(value * 10) / 10;

export function assertReceiptRule(policy: ClaimPolicyView, receiptFileId: string | null | undefined, kind: ClaimKind | null = null): void {
  const required = kind ? kind.receiptRequired : policy.receiptRequired;
  if (required && !receiptFileId) {
    throw new BadRequestException('A receipt is needed before a claim can be sent. Attach it and send again.');
  }
}
