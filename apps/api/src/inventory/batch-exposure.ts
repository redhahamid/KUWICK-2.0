/**
 * HOW MUCH OF A BATCH CAN STILL BE AT RISK.
 *
 * `StockBatch.quantity` is the quantity RECEIVED in that batch. Nothing ever
 * decrements it, because Kuwick does not attribute a dispense to a batch — an
 * outbound `StockMovement` names the item and the clinic, not the batch it came
 * from. So there is no batch-level balance in the system, and there cannot be
 * one until dispensing picks a batch.
 *
 * That matters because the near-expiry and expired reports filtered on
 * `quantity > 0` and described the result as "batches with stock still on
 * hand". It is not: a batch dispensed to nothing still reported its full
 * received quantity, and the value-at-risk figure multiplied that by cost. On a
 * fast-moving line that overstates the exposure by the whole batch.
 *
 * This is the same defect shape as the clinic's own payable workbook, whose
 * headline sums the payment-DATE column: a number under a heading that means
 * something else.
 *
 * The fix here guesses nothing. Two things are CERTAIN without batch-level
 * attribution:
 *
 *   1. If the clinic holds none of the item, none of any batch of it remains.
 *   2. No batch can have more left than the clinic holds of the item in total.
 *
 * So the exposure is bounded by the item's on-hand — a real, ledger-backed
 * figure — and both numbers are reported rather than one being passed off as
 * the other. What is NOT done is inferring a per-batch remainder by allocating
 * on-hand across batches in expiry order: that assumes the clinic actually
 * dispenses first-expiry-first, and an assumption presented as a quantity is
 * exactly what this codebase refuses to do elsewhere.
 */

export interface BatchExposureFacts {
  /** Quantity received in this batch. Never decremented — see above. */
  receivedQuantity: number;
  /** The item's current on-hand at this clinic, from the movement ledger. */
  itemOnHand: number;
}

export interface BatchExposure {
  receivedQuantity: number;
  itemOnHand: number;
  /**
   * The most of this batch that can still be on the shelf. `min(received,
   * onHand)`, floored at zero — a certainty, not an estimate.
   */
  atRiskCeiling: number;
  /**
   * TRUE when the clinic holds none of the item, so nothing of this batch
   * remains and it does not belong on an expiry worklist at all.
   */
  fullyConsumed: boolean;
}

export function batchExposure(facts: BatchExposureFacts): BatchExposure {
  const received = Math.max(facts.receivedQuantity, 0);
  // Negative on-hand is a real state in Kuwick (D-043 permits it), and it means
  // the clinic believes it holds less than nothing — certainly not stock at
  // risk of expiring.
  const onHand = Math.max(facts.itemOnHand, 0);
  const ceiling = Math.min(received, onHand);
  return {
    receivedQuantity: received,
    itemOnHand: onHand,
    atRiskCeiling: ceiling,
    fullyConsumed: onHand === 0,
  };
}

/**
 * The most this batch can be worth at cost. Uses the ceiling, never the
 * received quantity: the old figure charged a fully-dispensed batch to the
 * expiry report at its full purchase value.
 */
export function batchExposureValueCents(exposure: BatchExposure, unitCostCents: number): number {
  return exposure.atRiskCeiling * Math.max(unitCostCents, 0);
}
