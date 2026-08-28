import { Prisma } from '@prisma/client';
import { LineTax, TaxBasis, TaxCodeSnapshot, computeLineTax } from './tax';
import { fromCents, sumCents, toCents } from './money';

/**
 * APPLYING TAX TO AN INVOICE — the part that has to be right about WHO pays it.
 *
 * Two decisions, both stated rather than implied:
 *
 *  1. THE BASIS DEFAULTS TO THE PATIENT PORTION. The owner brief is explicit:
 *     "do not tax panel share unless configuration/law indicates the item/
 *     payer portion is taxable." A panel's contractual rate is negotiated
 *     gross, and adding service tax on top of the panel's share is a charge
 *     the panel has not agreed to pay. A clinic whose contracts say otherwise
 *     changes `finance.taxBasis` to FULL_LINE; nothing here guesses.
 *
 *  2. THE TAX LANDS ON THE PATIENT'S RESPONSIBILITY. It has to land somewhere,
 *     because the invariant `panel + patient = total` is enforced by tests and
 *     relied on by the settlement engine. Charging tax to the payer who is
 *     actually asked for it keeps that invariant true and keeps the panel's
 *     receivable equal to what was negotiated.
 *
 * INERT UNTIL CONFIGURED. Every line whose item or service carries no tax code
 * produces zero tax and a NULL treatment, so an invoice in a clinic that has
 * not set tax up is byte-for-byte what it was before this module existed.
 */

export const TAX_BASIS_SETTING_KEY = 'finance.taxBasis';

export interface TaxableLine {
  id: string;
  amount: Prisma.Decimal | number | string;
  lineDiscountAmount?: Prisma.Decimal | number | string | null;
  patientResponsibilityAmount?: Prisma.Decimal | number | string | null;
  taxCodeId?: string | null;
  cancelledAt?: Date | null;
}

export interface AppliedLineTax {
  id: string;
  taxAmount: number;
  taxRatePercent: number | null;
  taxTreatment: LineTax['treatment'];
}

export interface AppliedInvoiceTax {
  lines: AppliedLineTax[];
  taxCents: number;
  /** Lines that bill money but carry no tax classification. Surfaced, never assumed. */
  unclassifiedLineIds: string[];
}

export function applyInvoiceTax(input: {
  lines: TaxableLine[];
  codes: Map<string, TaxCodeSnapshot>;
  on: Date;
  basis: TaxBasis;
}): AppliedInvoiceTax {
  const applied: AppliedLineTax[] = [];
  const unclassifiedLineIds: string[] = [];

  for (const line of input.lines) {
    if (line.cancelledAt) {
      applied.push({ id: line.id, taxAmount: 0, taxRatePercent: null, taxTreatment: null });
      continue;
    }
    const code = line.taxCodeId ? (input.codes.get(line.taxCodeId) ?? null) : null;
    const tax = computeLineTax({
      amount: line.amount as never,
      lineDiscountAmount: (line.lineDiscountAmount ?? 0) as never,
      patientResponsibilityAmount: (line.patientResponsibilityAmount ?? null) as never,
      taxCode: code,
      basis: input.basis,
      on: input.on,
    });
    if (tax.unmapped && toCents(line.amount as never) !== 0) {
      unclassifiedLineIds.push(line.id);
    }
    applied.push({
      id: line.id,
      taxAmount: fromCents(tax.taxCents),
      taxRatePercent: tax.ratePercent,
      taxTreatment: tax.treatment,
    });
  }

  return {
    lines: applied,
    taxCents: sumCents(applied.map((line) => line.taxAmount)),
    unclassifiedLineIds,
  };
}

/** Reads the tenant's chosen basis. Defaults to the conservative one. */
export function taxBasisFrom(settingValue: unknown): TaxBasis {
  return settingValue === 'FULL_LINE' ? 'FULL_LINE' : 'PATIENT_PORTION';
}
