import { dispenseAmount, dispenseCalculation } from './dispense-pricing';

// ===========================================================================
// CLINICAL QUANTITY vs DISPENSE QUANTITY.
//
// The clinic's own import settles what `sellPrice` is per:
//   C. OSELTAMIVIR 75MG   RM 155.00   "10 BIJI / STRIP"
//   C. CELECOXIB 200MG    RM  26.00   "10 BIJI / STRIP"
//   KETOPROFEN PLASTER    RM  17.00   "7 SHEETS / PACK"
// RM155 is a course of Tamiflu, not one capsule. The price is per PACK, so
// `quantity × unitPrice` bills a ten-capsule course at RM1,550.
// ===========================================================================

const strip = { quantityPerStockUnit: 10 };

describe('whole packs, and the arithmetic that produces them', () => {
  it('divides the clinical quantity by the pack size', () => {
    expect(dispenseCalculation(30, strip)).toMatchObject({
      clinicalQuantity: 30,
      divisor: 10,
      dispenseQuantity: 3,
      reason: null,
    });
  });

  it('rounds UP on a partial pack — down would give the remainder away', () => {
    // 25 tablets out of strips of 10 is three strips handed over. Charging for
    // two means the patient leaves with five tablets the clinic did not bill.
    expect(dispenseCalculation(25, strip).dispenseQuantity).toBe(3);
    expect(dispenseCalculation(21, strip).dispenseQuantity).toBe(3);
    expect(dispenseCalculation(11, strip).dispenseQuantity).toBe(2);
  });

  it('never rounds down, even at the smallest fraction of a pack', () => {
    expect(dispenseCalculation(1, strip).dispenseQuantity).toBe(1);
  });

  it('leaves an exact multiple alone', () => {
    expect(dispenseCalculation(20, strip).dispenseQuantity).toBe(2);
  });

  it('takes the clinic’s number over the import’s', () => {
    // 1E: only they know whether their strips hold 10 or 12.
    expect(dispenseCalculation(24, { quantityPerStockUnit: 12, unitsPerPack: 10 })).toMatchObject({
      divisor: 12,
      dispenseQuantity: 2,
    });
  });

  it('uses the import’s parse when the clinic has not said', () => {
    expect(dispenseCalculation(30, { unitsPerPack: 10 }).dispenseQuantity).toBe(3);
  });
});

describe('the money', () => {
  it('charges the pack price per pack, not per tablet', () => {
    // The live defect: 10 × 155.00 = 1550.00 for one course of Tamiflu.
    const calculation = dispenseCalculation(10, strip);
    expect(dispenseAmount(155, calculation)).toBe(155);
  });

  it('prices a two-and-a-bit-pack course as three packs', () => {
    expect(dispenseAmount(26, dispenseCalculation(25, strip))).toBe(78);
  });

  it('rounds money to two places, like the rest of billing', () => {
    expect(dispenseAmount(4.505, dispenseCalculation(10, strip))).toBe(4.51);
  });
});

describe('no divisor means NO PRICE, never a fallback of 1', () => {
  it('refuses to price a medicine nobody has counted', () => {
    // Falling back to 1 is the identity that produces the RM1,550.
    const calculation = dispenseCalculation(30, {});
    expect(calculation).toMatchObject({ dispenseQuantity: null, attention: 'NO_DIVISOR' });
    expect(dispenseAmount(155, calculation)).toBeNull();
  });

  it('says WHY, and what to do about it', () => {
    const { reason } = dispenseCalculation(30, {});
    expect(reason).toContain('no quantity per stock unit');
    expect(reason).toContain('dispensed whole');
  });

  it('gives null rather than zero — RM 0.00 reads as a medicine given away', () => {
    expect(dispenseAmount(null, dispenseCalculation(30, strip))).toBeNull();
  });

  it('treats a zero or negative divisor as no divisor at all', () => {
    expect(dispenseCalculation(30, { quantityPerStockUnit: 0 }).dispenseQuantity).toBeNull();
    expect(dispenseCalculation(30, { unitsPerPack: -5 }).attention).toBe('NO_DIVISOR');
  });
});

describe('a divisor of 1', () => {
  it('PRICES, whether or not anybody has confirmed it', () => {
    // Refusing to bill the visit is a different job from asking somebody to
    // check the catalogue. If the 1 is right, the arithmetic is right.
    const calculation = dispenseCalculation(3, { quantityPerStockUnit: 1 });
    expect(calculation.dispenseQuantity).toBe(3);
    expect(dispenseAmount(12, calculation)).toBe(36);
  });

  it('stays on the worklist while it is unconfirmed', () => {
    expect(dispenseCalculation(3, { quantityPerStockUnit: 1 }).attention).toBe('UNCONFIRMED_ONE');
  });

  it('comes off the worklist once it is declared', () => {
    expect(
      dispenseCalculation(3, { quantityPerStockUnit: 1, dispensedWholeAt: new Date() }).attention,
    ).toBeNull();
  });
});

describe('a quantity that is not a quantity', () => {
  it.each([0, -5, Number.NaN])('refuses to price %p rather than inventing a charge', (quantity) => {
    const calculation = dispenseCalculation(quantity, strip);
    expect(calculation.dispenseQuantity).toBeNull();
    expect(dispenseAmount(26, calculation)).toBeNull();
  });

  it('rounds a fractional clinical quantity UP before dividing', () => {
    // 2.5ml doses over five days can produce a fraction. Half a tablet is
    // still a tablet off the shelf.
    expect(dispenseCalculation(10.5, strip)).toMatchObject({ clinicalQuantity: 11, dispenseQuantity: 2 });
  });
});
