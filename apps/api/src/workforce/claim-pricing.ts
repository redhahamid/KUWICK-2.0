import { BadRequestException } from '@nestjs/common';

/**
 * ONE PRICE AND ONE RECEIPT RULE FOR A CLAIM, whoever keys it.
 *
 * The portal priced mileage from the kilometres at the clinic's rate and
 * insisted on a receipt when the policy says so; the HR route took any
 * amount and no receipt. A claim HR enters from a paper receipt is the same
 * claim, so both routes now come here.
 */
export interface ClaimPolicyView {
  mileageRatePerKm: string;
  receiptRequired: boolean;
}

export function priceClaim(
  input: { amountClaimed: string; distanceKm?: number | null },
  policy: ClaimPolicyView,
): { amountClaimed: string; distanceKm: number | null; mileageRate: string | null } {
  const mileage = input.distanceKm !== undefined && input.distanceKm !== null;
  const rate = Number(policy.mileageRatePerKm);
  // The kilometres are the fact and the rate on the day is the price, whatever the screen showed.
  const amountClaimed = mileage ? (Math.round((input.distanceKm as number) * rate * 100) / 100).toFixed(2) : input.amountClaimed;
  if (Number(amountClaimed) <= 0) throw new BadRequestException('A claim must be for more than nothing.');
  return {
    amountClaimed,
    distanceKm: mileage ? (input.distanceKm as number) : null,
    mileageRate: mileage ? rate.toFixed(2) : null,
  };
}

export function assertReceiptRule(policy: ClaimPolicyView, receiptFileId: string | null | undefined): void {
  if (policy.receiptRequired && !receiptFileId) {
    throw new BadRequestException('A receipt is needed before a claim can be sent. Attach it and send again.');
  }
}
