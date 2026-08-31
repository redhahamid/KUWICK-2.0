import { batchExposure, batchExposureValueCents } from './batch-exposure';

describe('how much of a batch can still be at risk', () => {
  it('1. a batch of 100 with 100 of the item on hand is fully at risk', () => {
    expect(batchExposure({ receivedQuantity: 100, itemOnHand: 100 })).toEqual({
      receivedQuantity: 100,
      itemOnHand: 100,
      atRiskCeiling: 100,
      fullyConsumed: false,
    });
  });

  it('2. a batch of 100 with 30 of the item left can risk at most 30', () => {
    // No batch can have more left than the clinic holds of the item in total.
    expect(batchExposure({ receivedQuantity: 100, itemOnHand: 30 }).atRiskCeiling).toBe(30);
  });

  it('3. a batch of an item the clinic no longer holds is fully consumed', () => {
    const exposure = batchExposure({ receivedQuantity: 100, itemOnHand: 0 });
    expect(exposure.fullyConsumed).toBe(true);
    expect(exposure.atRiskCeiling).toBe(0);
  });

  it('4. a NEGATIVE on-hand is not stock at risk of expiring', () => {
    // Kuwick permits negative on-hand deliberately; it means the clinic
    // believes it holds less than nothing, which is a different problem.
    const exposure = batchExposure({ receivedQuantity: 100, itemOnHand: -20 });
    expect(exposure.atRiskCeiling).toBe(0);
    expect(exposure.fullyConsumed).toBe(true);
  });

  it('5. holding MORE of the item than this batch brought in does not inflate the batch', () => {
    // Three batches of 50 and 150 on hand: this batch is still only 50.
    expect(batchExposure({ receivedQuantity: 50, itemOnHand: 150 }).atRiskCeiling).toBe(50);
  });

  it('6. value at risk uses the ceiling, never the received quantity', () => {
    const exposure = batchExposure({ receivedQuantity: 100, itemOnHand: 10 });
    // The old figure charged this to the expiry report at RM250; it is RM25.
    expect(batchExposureValueCents(exposure, 250)).toBe(2_500);
  });

  it('7. an item with no cost recorded is worth nothing at risk, not NaN', () => {
    const exposure = batchExposure({ receivedQuantity: 40, itemOnHand: 40 });
    expect(batchExposureValueCents(exposure, 0)).toBe(0);
  });
});
