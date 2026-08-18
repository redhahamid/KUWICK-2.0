import { DivisorAttention, divisorFacts } from '../inventory/dispensing-divisor';

/**
 * CLINICAL QUANTITY IS NOT DISPENSE QUANTITY, AND THE BILL HAS BEEN CONFUSING
 * THEM.
 *
 * A prescription's `quantity` is what the doctor wrote: 30 tablets. It is
 * computed as dose × doses-per-day × days and it is counted in DOSE UNITS.
 *
 * `Item.sellPrice` is not a per-tablet price. The clinic's own import makes
 * that unambiguous once you read the rows beside their pack strings:
 *
 *     C. OSELTAMIVIR 75MG (FLUHALT)   RM 155.00   "10 BIJI / STRIP"
 *     C. CELECOXIB 200MG (RABIROX)    RM  26.00   "10 BIJI / STRIP"
 *     KETOPROFEN PLASTER 30MG         RM  17.00   "7 SHEETS / PACK"
 *
 * RM155 is a course of Tamiflu, not one capsule. RM17 is a pack of seven
 * plasters, not one. **The price is per STOCK UNIT.**
 *
 * So `amount = quantity × unitPrice` — which is what the draft and the invoice
 * have both been doing — bills a ten-capsule course of Oseltamivir at
 * RM 1,550.00. The correct charge is `ceil(30 ÷ 10) × 26.00`: you cannot hand
 * over two-fifths of a strip, so the clinic gives whole packs and charges for
 * whole packs.
 *
 * CEIL, NEVER DOWN, and it is not a rounding preference. Rounding down means
 * handing over three strips and charging for two. The patient leaves with
 * stock the clinic gave away, every time, on every partial pack.
 *
 * NO DIVISOR MEANS NO PRICE. `ceil(30 ÷ null)` is not a number, and the one
 * thing that must never happen is falling back to 1 — that is the identity
 * that produces the RM1,550. An item with no divisor prices as UNPRICED with
 * a reason, and is counted in the outstanding chip so somebody fixes it.
 */

export interface DispenseCalculation {
  /** What the doctor wrote, in dose units. */
  clinicalQuantity: number;
  /** How many dose units are in one stock unit. Null means nobody has said. */
  divisor: number | null;
  /** Whole stock units to hand over and charge for. Null when it cannot be known. */
  dispenseQuantity: number | null;
  /** Why there is no dispense quantity. Null when there is one. */
  attention: DivisorAttention | null;
  /** Words for the invoice line, so an unpriced line is never a silent one. */
  reason: string | null;
}

export interface DispenseItem {
  quantityPerStockUnit?: number | null;
  unitsPerPack?: number | null;
  dispensedWholeAt?: Date | string | null;
}

/**
 * The one conversion. Every surface that turns a prescription into money or
 * into stock has to go through here, or they will disagree about what a unit
 * is — which is the whole class of defect this exists to end.
 */
export function dispenseCalculation(clinicalQuantity: number, item: DispenseItem): DispenseCalculation {
  const facts = divisorFacts(item);

  // A clinical quantity that is not a positive number is not something to
  // divide. Reporting it as unpriceable is safer than producing a charge from
  // a quantity nobody wrote.
  const clinical =
    Number.isFinite(clinicalQuantity) && clinicalQuantity > 0 ? Math.ceil(clinicalQuantity) : null;

  if (clinical === null) {
    return {
      clinicalQuantity,
      divisor: facts.divisor,
      dispenseQuantity: null,
      attention: facts.attention,
      reason: 'This prescription has no quantity to dispense.',
    };
  }

  if (facts.divisor === null) {
    return {
      clinicalQuantity: clinical,
      divisor: null,
      dispenseQuantity: null,
      attention: 'NO_DIVISOR',
      reason:
        'This medicine has no quantity per stock unit, so the number of packs to dispense cannot be worked out. Set it on the item, or record that the item is dispensed whole.',
    };
  }

  return {
    clinicalQuantity: clinical,
    divisor: facts.divisor,
    // Whole packs. Two and a half strips is three strips handed over and three
    // strips charged for — rounding down would give the half away.
    dispenseQuantity: Math.ceil(clinical / facts.divisor),
    // A divisor of 1 that nobody has confirmed still PRICES — it is the right
    // arithmetic if the 1 is right. It stays on the worklist so somebody
    // checks, which is a different job from refusing to bill the visit.
    attention: facts.attention,
    reason: null,
  };
}

/** Two decimal places, the same rounding the rest of billing uses. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * What the line costs: whole packs × the pack price.
 *
 * Null when it cannot be known, never zero — RM 0.00 reads as a medicine the
 * clinic gave away, which is a claim about generosity rather than an admission
 * of a missing number.
 */
export function dispenseAmount(unitPrice: number | null, calculation: DispenseCalculation): number | null {
  if (unitPrice === null || calculation.dispenseQuantity === null) return null;
  return round2(unitPrice * calculation.dispenseQuantity);
}
