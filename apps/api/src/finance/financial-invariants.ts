/**
 * THE FINANCIAL INVARIANTS.
 *
 * Owner brief §7: "Every financial aggregate must be mathematically
 * reproducible from underlying records." This module is that requirement
 * written as code — pure functions over plain inputs, no Prisma, no clock, no
 * tenant. Every screen that shows a balance, a receivable or an outstanding
 * figure calls one of these; none of them adds up money on its own.
 *
 * The reason for one module rather than a helper per report: an aggregate
 * computed in two places is an aggregate that will eventually disagree with
 * itself, and when the two places are "the invoice screen" and "the day-end
 * closing", the disagreement is what a clinic discovers at 9pm with the till
 * open.
 *
 * ALL AMOUNTS ARE CENTS. See money.ts for why.
 */

import { MoneyLike, clampAtZero, sumCents, toCents } from './money';

// ---------------------------------------------------------------------------
// Inputs. Deliberately structural rather than Prisma types: a unit test builds
// these by hand, and a report can project exactly the columns it needs.
// ---------------------------------------------------------------------------

export interface InvoiceLineFacts {
  /** quantity × unitPrice, BEFORE the line discount. */
  amount: MoneyLike;
  lineDiscountAmount?: MoneyLike;
  taxAmount?: MoneyLike;
  /** A cancelled line is a historical fact that no longer bills. */
  cancelledAt?: Date | string | null;
}

export interface PaymentFacts {
  kind: 'PAYMENT' | 'REFUND';
  amount: MoneyLike;
  /** A reversed payment never happened, financially. It still happened, historically. */
  reversedAt?: Date | string | null;
}

export interface CreditNoteFacts {
  status: 'DRAFT' | 'ISSUED' | 'VOID';
  totalAmount: MoneyLike;
}

export interface InvoiceTotals {
  /** Sum of active line amounts, before any discount. */
  subtotalCents: number;
  /** Line-level discounts, summed. */
  lineDiscountCents: number;
  /** The single invoice-wide discount, if any. */
  invoiceDiscountCents: number;
  /** Tax, summed from the lines. */
  taxCents: number;
  /** What the invoice asks for. */
  grandTotalCents: number;
}

// ---------------------------------------------------------------------------
// INVARIANT 1 — the invoice grand total
//
//   grand total = Σ active line amounts
//               − Σ line discounts
//               − invoice discount
//               + Σ line tax
//
// Tax is added last and computed on the DISCOUNTED line (see tax.ts), so it is
// summed here rather than re-derived: the line already knows its own tax, and
// re-deriving it at the invoice level is how a rounding difference of one cent
// per line becomes a mismatch of forty.
// ---------------------------------------------------------------------------

export function computeInvoiceTotals(
  lines: InvoiceLineFacts[],
  invoiceDiscount: MoneyLike = 0,
): InvoiceTotals {
  const active = lines.filter((line) => !line.cancelledAt);
  const subtotalCents = sumCents(active.map((line) => line.amount));
  const lineDiscountCents = sumCents(active.map((line) => line.lineDiscountAmount ?? 0));
  const taxCents = sumCents(active.map((line) => line.taxAmount ?? 0));
  const invoiceDiscountCents = toCents(invoiceDiscount);

  return {
    subtotalCents,
    lineDiscountCents,
    invoiceDiscountCents,
    taxCents,
    grandTotalCents: subtotalCents - lineDiscountCents - invoiceDiscountCents + taxCents,
  };
}

// ---------------------------------------------------------------------------
// INVARIANT 2 — what has actually been received
//
//   net received = Σ valid PAYMENTs − Σ valid REFUNDs
//
// "Valid" means not reversed. A reversal does not delete the payment; it makes
// it stop counting, which is a different and honest thing.
// ---------------------------------------------------------------------------

export function netReceivedCents(payments: PaymentFacts[]): number {
  return payments
    .filter((payment) => !payment.reversedAt)
    .reduce((total, payment) => total + (payment.kind === 'REFUND' ? -1 : 1) * toCents(payment.amount), 0);
}

/** Gross collected, ignoring refunds — what the drawer saw come IN. */
export function grossReceivedCents(payments: PaymentFacts[]): number {
  return payments
    .filter((payment) => !payment.reversedAt && payment.kind === 'PAYMENT')
    .reduce((total, payment) => total + toCents(payment.amount), 0);
}

export function refundedCents(payments: PaymentFacts[]): number {
  return payments
    .filter((payment) => !payment.reversedAt && payment.kind === 'REFUND')
    .reduce((total, payment) => total + toCents(payment.amount), 0);
}

// ---------------------------------------------------------------------------
// INVARIANT 3 — credits
//
// Only an ISSUED credit note reduces anything. A DRAFT has not been approved
// and a VOID one has been withdrawn; counting either would let an unapproved
// document move the clinic's revenue.
// ---------------------------------------------------------------------------

export function creditedCents(creditNotes: CreditNoteFacts[]): number {
  return sumCents(creditNotes.filter((note) => note.status === 'ISSUED').map((note) => note.totalAmount));
}

// ---------------------------------------------------------------------------
// INVARIANT 4 — the patient's outstanding balance
//
//   balance = patient responsibility − net received − credits
//
// PATIENT RESPONSIBILITY, not the grand total. On a panel visit the grand
// total includes the panel's share, and asking the patient for it is the
// single most damaging arithmetic error this system could make. The panel's
// share is chased through the CLAIM (invariant 5), never through this number.
//
// Clamped at zero: an over-collection is a refund waiting to happen, not a
// negative debt, and showing "−RM20 outstanding" in an aging bucket is how a
// receivables total silently under-reports.
// ---------------------------------------------------------------------------

export interface PatientBalanceInput {
  patientResponsibility: MoneyLike;
  payments: PaymentFacts[];
  creditNotes?: CreditNoteFacts[];
}

export interface PatientBalance {
  responsibilityCents: number;
  netReceivedCents: number;
  creditedCents: number;
  /** What the patient still owes. Never negative. */
  balanceCents: number;
  /** Money taken beyond what was owed. Never negative. The mirror of `balanceCents`. */
  overpaidCents: number;
  settled: boolean;
}

export function computePatientBalance(input: PatientBalanceInput): PatientBalance {
  const responsibilityCents = toCents(input.patientResponsibility);
  const received = netReceivedCents(input.payments);
  const credited = creditedCents(input.creditNotes ?? []);
  const raw = responsibilityCents - received - credited;

  return {
    responsibilityCents,
    netReceivedCents: received,
    creditedCents: credited,
    balanceCents: clampAtZero(raw),
    overpaidCents: clampAtZero(-raw),
    settled: raw <= 0,
  };
}

// ---------------------------------------------------------------------------
// INVARIANT 5 — the panel receivable
//
//   expected receivable = claimed + panel fee            (what we asked for)
//   settled             = approved − rejected            (what they agreed)
//   outstanding         = expected − received − written off
//
// The distinction that makes this module worth having: CLAIM SENT and MONEY
// RECEIVED are not the same event and never collapse into one number. A claim
// can be submitted, approved, and still unpaid ninety days later — which is
// precisely the situation the panel module exists to make visible.
// ---------------------------------------------------------------------------

/**
 * HOW A PANEL'S ADMIN FEE IS TREATED IN THE RECEIVABLE.
 *
 * `'WITHHELD_FROM_CLAIM'` — expected = claimed − fee. The panel keeps its fee
 *                           out of the payment.
 * `'ADDED_TO_RECEIVABLE'` — expected = claimed + fee.
 * `'NO_FEE'`              — the panel charges nothing; expected = claimed.
 * `'UNCONFIGURED'`        — nobody has established the rule. The fee is applied
 *                           in NEITHER direction and `feeTreatmentResolved`
 *                           comes back false, because a fee whose sign is
 *                           unknown is worse than no fee at all.
 *
 * **D-041 IS SUPERSEDED ON THIS POINT** (owner decision, 2026-08-31). It
 * recorded `claimed + fee`. Reading the clinic's own claim workbook settled it
 * the other way: every one of its 29 sheets computes `claim to receive =
 * claimed − fee`, and of 2,640 fee-bearing claims that were actually paid,
 * 2,615 arrived as exactly claimed − fee, two at the claimed amount, and NONE
 * at claimed + fee. The owner accepted that evidence as the source of truth for
 * the current panel setup and set WITHHELD as the default for existing panels.
 *
 * `NO_FEE` and `UNCONFIGURED` are separate on purpose. Collapsing them into one
 * NULL was the previous design, and it made a panel that charges nothing
 * indistinguishable from one nobody has asked about — so the screens could not
 * tell an owner which panels actually needed an answer.
 *
 * See `docs/PANEL_LEGACY_WORKFLOW_AUDIT.md` P-1 / G-1 and
 * `docs/PANEL_FEE_DIRECTION_CORRECTION.md`.
 */
export type ClaimFeeTreatment =
  | 'WITHHELD_FROM_CLAIM'
  | 'ADDED_TO_RECEIVABLE'
  | 'NO_FEE'
  | 'UNCONFIGURED';

export interface ClaimFacts {
  claimedAmount: MoneyLike;
  /** The panel's per-claim admin fee. See `feeTreatment` for how it is applied. */
  feeAmount?: MoneyLike;
  /** Per-panel configuration, snapshotted onto the claim. Undefined reads as UNCONFIGURED. */
  feeTreatment?: ClaimFeeTreatment | null;
  /** What the panel said it would pay. NULL until they have said anything. */
  approvedAmount?: MoneyLike | null;
  /** What they refused. */
  rejectedAmount?: MoneyLike | null;
  /** Money actually banked against this claim. */
  receivedAmount?: MoneyLike | null;
  writtenOffAmount?: MoneyLike | null;
  status?: string;
}

export interface ClaimBalance {
  claimedCents: number;
  feeCents: number;
  /**
   * What the clinic can expect back.
   *
   * `WITHHELD_FROM_CLAIM` → claimed − fee
   * `ADDED_TO_RECEIVABLE` → claimed + fee
   * `NO_FEE`              → claimed
   * `UNCONFIGURED`        → claimed, with `feeTreatmentResolved` false
   */
  expectedReceivableCents: number;
  /**
   * FALSE when this claim carries a fee whose treatment nobody has established.
   * The expected receivable above is then the claimed amount with the fee left
   * out entirely, and every screen showing it must say so rather than present
   * it as settled arithmetic.
   */
  feeTreatmentResolved: boolean;
  approvedCents: number;
  rejectedCents: number;
  receivedCents: number;
  writtenOffCents: number;
  /**
   * What is still genuinely collectable.
   *
   * Before adjudication (`approvedAmount` NULL) the base is what was claimed —
   * optimistic, and labelled as such everywhere it is shown. Once the panel has
   * adjudicated, the base becomes what they APPROVED, because chasing a
   * rejected amount as if it were receivable is how a clinic's receivables
   * ledger drifts permanently above what it will ever bank.
   */
  outstandingCents: number;
  /** True once the panel has told us something. */
  adjudicated: boolean;
}

export function computeClaimBalance(claim: ClaimFacts): ClaimBalance {
  const claimedCents = toCents(claim.claimedAmount);
  const feeCents = toCents(claim.feeAmount ?? 0);
  const treatment: ClaimFeeTreatment = claim.feeTreatment ?? 'UNCONFIGURED';
  // A zero fee has no sign to get wrong, so it is resolved trivially whatever
  // the panel's treatment says.
  const feeTreatmentResolved = feeCents === 0 || treatment !== 'UNCONFIGURED';
  const expectedReceivableCents =
    treatment === 'ADDED_TO_RECEIVABLE'
      ? claimedCents + feeCents
      : treatment === 'WITHHELD_FROM_CLAIM'
        ? claimedCents - feeCents
        : claimedCents;
  const adjudicated = claim.approvedAmount !== null && claim.approvedAmount !== undefined;
  const approvedCents = toCents(claim.approvedAmount ?? 0);
  const rejectedCents = toCents(claim.rejectedAmount ?? 0);
  const receivedCents = toCents(claim.receivedAmount ?? 0);
  const writtenOffCents = toCents(claim.writtenOffAmount ?? 0);

  const collectableBase = adjudicated ? approvedCents : expectedReceivableCents;

  return {
    claimedCents,
    feeCents,
    expectedReceivableCents,
    feeTreatmentResolved,
    approvedCents,
    rejectedCents,
    receivedCents,
    writtenOffCents,
    outstandingCents: clampAtZero(collectableBase - receivedCents - writtenOffCents),
    adjudicated,
  };
}

/** Panel-level rollup. Same arithmetic, summed — never a second formula. */
export function rollUpClaims(claims: ClaimFacts[]) {
  const balances = claims.map(computeClaimBalance);
  return {
    count: balances.length,
    /**
     * How many of those claims carry a fee whose treatment is not established.
     * Non-zero means this panel's expected receivable is understated by the
     * fees it excluded, and the screen must say which panel to go and answer.
     */
    unresolvedFeeTreatmentCount: balances.filter((balance) => !balance.feeTreatmentResolved).length,
    claimedCents: balances.reduce((total, balance) => total + balance.claimedCents, 0),
    feeCents: balances.reduce((total, balance) => total + balance.feeCents, 0),
    expectedReceivableCents: balances.reduce((total, balance) => total + balance.expectedReceivableCents, 0),
    approvedCents: balances.reduce((total, balance) => total + balance.approvedCents, 0),
    rejectedCents: balances.reduce((total, balance) => total + balance.rejectedCents, 0),
    receivedCents: balances.reduce((total, balance) => total + balance.receivedCents, 0),
    writtenOffCents: balances.reduce((total, balance) => total + balance.writtenOffCents, 0),
    outstandingCents: balances.reduce((total, balance) => total + balance.outstandingCents, 0),
  };
}

// ---------------------------------------------------------------------------
// AGING
//
// Buckets are inclusive-low, exclusive-high on DAYS ELAPSED, and "current"
// means 0–30. The bucket edges live here so the receivables dashboard, the
// panel work queue and the outstanding-invoice report cannot each pick their
// own idea of what "60 days" means.
// ---------------------------------------------------------------------------

export type AgingBucket = 'CURRENT' | 'D31_60' | 'D61_90' | 'D90_PLUS';

export const AGING_BUCKETS: AgingBucket[] = ['CURRENT', 'D31_60', 'D61_90', 'D90_PLUS'];

export const AGING_BUCKET_LABELS: Record<AgingBucket, string> = {
  CURRENT: '0–30 days',
  D31_60: '31–60 days',
  D61_90: '61–90 days',
  D90_PLUS: 'Over 90 days',
};

export function daysBetween(from: Date, to: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const fromUtc = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const toUtc = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.floor((toUtc - fromUtc) / MS_PER_DAY);
}

export function agingBucketOf(ageDays: number): AgingBucket {
  if (ageDays <= 30) return 'CURRENT';
  if (ageDays <= 60) return 'D31_60';
  if (ageDays <= 90) return 'D61_90';
  return 'D90_PLUS';
}

export function emptyAging(): Record<AgingBucket, number> {
  return { CURRENT: 0, D31_60: 0, D61_90: 0, D90_PLUS: 0 };
}

export function accumulateAging(
  into: Record<AgingBucket, number>,
  ageDays: number,
  amountCents: number,
): Record<AgingBucket, number> {
  into[agingBucketOf(ageDays)] += amountCents;
  return into;
}
