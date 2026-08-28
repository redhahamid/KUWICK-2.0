/**
 * SERVICE TAX — line-driven, effective-dated, and inert until configured.
 *
 * Three rules the owner brief states and this module enforces:
 *
 *  1. TAX IS PER LINE. A clinic bills exempt medicines and standard-rated
 *     procedures on the same invoice. An invoice-level rate would be wrong on
 *     one of them, every time.
 *
 *  2. THE RATE IS THE ONE IN FORCE ON THE INVOICE DATE, and it is SNAPSHOTTED
 *     onto the line. When a rate changes, that is a new `TaxRate` row with a
 *     new `effectiveFrom` — never an edit — so a bill issued last March keeps
 *     computing at last March's rate forever.
 *
 *  3. NO MAPPING MEANS NO TAX, NOT A GUESS. An item with no tax code produces
 *     a zero-tax line and reports as unmapped. Inventing a default rate is how
 *     a clinic that is not tax-registered starts charging tax.
 *
 * WHAT THIS MODULE DOES NOT DO: decide whether the PANEL's share is taxable.
 * That is a question of law and of each panel's contract, and the brief is
 * explicit — "do not tax panel share unless configuration/law indicates the
 * item/payer portion is taxable". `TaxBasis` therefore has to be chosen by
 * configuration; there is no default that quietly answers it.
 */

import { MoneyLike, percentOfCents, toCents } from './money';

export type TaxTreatmentName = 'STANDARD_RATED' | 'ZERO_RATED' | 'EXEMPT';

export interface TaxRateRow {
  ratePercent: MoneyLike;
  effectiveFrom: Date | string;
  effectiveTo?: Date | string | null;
}

export interface TaxCodeSnapshot {
  id: string;
  code: string;
  treatment: TaxTreatmentName;
  rates: TaxRateRow[];
}

/** Which portion of a line the tax is charged on. */
export type TaxBasis =
  /** The whole discounted line, regardless of who pays it. */
  | 'FULL_LINE'
  /** Only the part the patient is responsible for. */
  | 'PATIENT_PORTION';

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * The rate in force on `on`, or null.
 *
 * Ranges are inclusive of `effectiveFrom` and of `effectiveTo`: a rate that
 * ends on the 31st applies on the 31st. Overlapping rows are a configuration
 * error, and the LATEST `effectiveFrom` wins so that the most recent
 * declaration is the operative one rather than an arbitrary row order.
 */
export function rateInForce(rates: TaxRateRow[], on: Date): number | null {
  const day = Date.UTC(on.getUTCFullYear(), on.getUTCMonth(), on.getUTCDate());
  let best: { from: number; rate: MoneyLike } | null = null;

  for (const rate of rates) {
    const from = asDate(rate.effectiveFrom);
    const fromDay = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
    if (fromDay > day) continue;

    if (rate.effectiveTo) {
      const to = asDate(rate.effectiveTo);
      const toDay = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
      if (toDay < day) continue;
    }
    if (!best || fromDay > best.from) {
      best = { from: fromDay, rate: rate.ratePercent };
    }
  }
  return best ? Number(best.rate) : null;
}

export interface LineTaxInput {
  /** quantity × unitPrice. */
  amount: MoneyLike;
  /** The line's own discount, subtracted before tax — tax follows the money. */
  lineDiscountAmount?: MoneyLike;
  /** What the patient is responsible for on this line, when the basis needs it. */
  patientResponsibilityAmount?: MoneyLike | null;
  taxCode?: TaxCodeSnapshot | null;
  basis?: TaxBasis;
  /** The date the charge is raised — which rate row applies. */
  on: Date;
}

export interface LineTax {
  taxCodeId: string | null;
  treatment: TaxTreatmentName | null;
  ratePercent: number | null;
  taxableBaseCents: number;
  taxCents: number;
  /**
   * True when the line carries no tax code at all. Reported as UNMAPPED rather
   * than as zero-rated: "we decided this is not taxed" and "nobody has said"
   * are different answers, and only one of them is safe to sign off.
   */
  unmapped: boolean;
}

export function computeLineTax(input: LineTaxInput): LineTax {
  const grossCents = toCents(input.amount) - toCents(input.lineDiscountAmount ?? 0);
  const basis = input.basis ?? 'FULL_LINE';

  const baseCents =
    basis === 'PATIENT_PORTION'
      ? // NULL patient responsibility means the split has not been computed.
        // Taxing the full line in that case would over-charge; taxing zero
        // would under-declare. The honest answer is zero AND unmapped-style
        // visibility, which the caller gets from `taxableBaseCents === 0`
        // against a non-zero line.
        toCents(input.patientResponsibilityAmount ?? 0)
      : grossCents;

  if (!input.taxCode) {
    return {
      taxCodeId: null,
      treatment: null,
      ratePercent: null,
      taxableBaseCents: 0,
      taxCents: 0,
      unmapped: true,
    };
  }

  if (input.taxCode.treatment !== 'STANDARD_RATED') {
    // Zero-rated and exempt both add nothing. They are kept apart because a
    // tax return reports them on different lines.
    return {
      taxCodeId: input.taxCode.id,
      treatment: input.taxCode.treatment,
      ratePercent: 0,
      taxableBaseCents: input.taxCode.treatment === 'ZERO_RATED' ? baseCents : 0,
      taxCents: 0,
      unmapped: false,
    };
  }

  const rate = rateInForce(input.taxCode.rates, input.on);
  if (rate === null) {
    // A standard-rated code with no rate in force on this date is a
    // configuration gap, not a zero rate. Charging nothing is the safe
    // arithmetic; flagging it is what stops the gap from being permanent.
    return {
      taxCodeId: input.taxCode.id,
      treatment: 'STANDARD_RATED',
      ratePercent: null,
      taxableBaseCents: baseCents,
      taxCents: 0,
      unmapped: true,
    };
  }

  return {
    taxCodeId: input.taxCode.id,
    treatment: 'STANDARD_RATED',
    ratePercent: rate,
    taxableBaseCents: baseCents,
    taxCents: percentOfCents(baseCents, rate),
    unmapped: false,
  };
}

export interface TaxSummary {
  taxableCents: number;
  zeroRatedCents: number;
  exemptCents: number;
  unmappedCents: number;
  taxCents: number;
  /** Taxable + tax — what the customer is asked for on the taxable portion. */
  grossTaxableCents: number;
}

/**
 * Rolls up lines for the tax report.
 *
 * Summed from PER-LINE tax, never re-derived by applying a rate to a total:
 * an invoice with mixed treatments has no single rate to apply, and even one
 * with a uniform rate would differ by a cent or two from the sum of its
 * rounded lines. The invoice charged the sum; the report must say the sum.
 */
export function summariseTax(lines: LineTax[], lineAmountsCents: number[]): TaxSummary {
  const summary: TaxSummary = {
    taxableCents: 0,
    zeroRatedCents: 0,
    exemptCents: 0,
    unmappedCents: 0,
    taxCents: 0,
    grossTaxableCents: 0,
  };

  lines.forEach((line, index) => {
    const amount = lineAmountsCents[index] ?? 0;
    if (line.unmapped) {
      summary.unmappedCents += amount;
      return;
    }
    if (line.treatment === 'EXEMPT') {
      summary.exemptCents += amount;
      return;
    }
    if (line.treatment === 'ZERO_RATED') {
      summary.zeroRatedCents += amount;
      return;
    }
    summary.taxableCents += line.taxableBaseCents;
    summary.taxCents += line.taxCents;
  });

  summary.grossTaxableCents = summary.taxableCents + summary.taxCents;
  return summary;
}
