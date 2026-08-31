/**
 * PANEL MONEY, SEEN FROM FINANCE.
 *
 * The panel module answers "where is this claim". Finance has to answer four
 * different questions, and until now could answer none of them:
 *
 *   1. We billed panels X this month. Did we CLAIM X?
 *   2. A panel wired us money. Where is it in our finance figures?
 *   3. The panel kept part of it. What did that cost us this year?
 *   4. The amount they kept — was it the fee we expected, or more?
 *
 * Question 1 is the clinic's own Avixo reconciliation
 * (`docs/PANEL_LEGACY_WORKFLOW_AUDIT.md` §7), performed monthly by hand by
 * comparing a billing-system export against the claim workbook. It exists
 * because billed and claimed drift, and the drift is money nobody chases.
 *
 * Question 3 only became askable on 2026-08-31, when the owner established
 * that the fee is WITHHELD rather than added (D-112). A withheld fee is a real
 * cost of doing panel business — the clinic bills RM100 and banks RM92 — and a
 * cost that appears in no ledger is a cost nobody manages.
 *
 * Pure functions over plain inputs: no Prisma, no clock, no tenant. Same
 * discipline as `financial-invariants.ts` and `supplier-payables.ts`.
 *
 * ALL AMOUNTS ARE CENTS. See money.ts for why.
 */

import { ClaimFeeTreatment } from './financial-invariants';
import { MoneyLike, clampAtZero, toCents } from './money';

// ---------------------------------------------------------------------------
// 1 · BILLED vs CLAIMED — the reconciliation the clinic does by hand
// ---------------------------------------------------------------------------

export interface PanelBillingFacts {
  /**
   * What the invoice says the panel carries, snapshotted at settlement
   * (`Invoice.panelCoveredAmount`). This is the authoritative billed figure:
   * it is what the clinic decided the panel owes, at the moment it decided.
   */
  panelCoveredAmount: MoneyLike;
  /**
   * The sum of claims raised against this invoice that still OCCUPY it —
   * pending, accepted or paid. A rejected claim has been superseded and does
   * not count as having claimed the money; that is what makes the invoice
   * claimable again.
   */
  activeClaimedAmount?: MoneyLike;
}

export type PanelBillingState =
  /** Billed and claimed, to the cent. */
  | 'CLAIMED'
  /** Billed, never claimed. Money the clinic is owed and has not asked for. */
  | 'UNCLAIMED'
  /** Claimed for less than was billed. The remainder is unasked-for money. */
  | 'UNDER_CLAIMED'
  /**
   * Claimed for MORE than was billed. Not a windfall — it is a claim the panel
   * can reject in full, and a compliance exposure if it is not.
   */
  | 'OVER_CLAIMED';

export interface PanelBillingPosition {
  billedCents: number;
  claimedCents: number;
  /** Billed but not claimed. Never negative — see `overClaimedCents`. */
  unclaimedCents: number;
  /** Claimed beyond what was billed. Never negative. The mirror of the above. */
  overClaimedCents: number;
  state: PanelBillingState;
}

export function panelBillingPosition(facts: PanelBillingFacts): PanelBillingPosition {
  const billedCents = toCents(facts.panelCoveredAmount);
  const claimedCents = toCents(facts.activeClaimedAmount ?? 0);
  const unclaimedCents = clampAtZero(billedCents - claimedCents);
  const overClaimedCents = clampAtZero(claimedCents - billedCents);

  const state: PanelBillingState =
    overClaimedCents > 0
      ? 'OVER_CLAIMED'
      : unclaimedCents === 0
        ? 'CLAIMED'
        : claimedCents === 0
          ? 'UNCLAIMED'
          : 'UNDER_CLAIMED';

  return { billedCents, claimedCents, unclaimedCents, overClaimedCents, state };
}

// ---------------------------------------------------------------------------
// 2 · WHAT THE FEE COSTS — the finance consequence of D-112
// ---------------------------------------------------------------------------

export interface PanelFeeCostFacts {
  feeAmount: MoneyLike;
  feeTreatment?: ClaimFeeTreatment | null;
  /** Money actually received against the claim. */
  receivedAmount?: MoneyLike;
  /** What is still owed on the claim, from `computeClaimBalance`. */
  outstandingCents: number;
}

export type PanelFeeCostState =
  /**
   * The claim settled and money arrived. Whatever the panel kept, it kept —
   * this fee is spent.
   */
  | 'BORNE'
  /** Still owed. The fee will be taken when they pay, but has not been yet. */
  | 'EXPECTED'
  /**
   * The claim ended without payment — written off, or rejected outright. No
   * fee was withheld because nothing was remitted.
   */
  | 'NOT_BORNE'
  /** This panel adds its fee to the bill, or charges none. Not a cost at all. */
  | 'NOT_A_COST';

export interface PanelFeeCost {
  costCents: number;
  state: PanelFeeCostState;
}

/**
 * A fee is a COST only where it is withheld from the payment.
 *
 * Under `ADDED_TO_RECEIVABLE` the panel pays the fee on top of the claim, so it
 * is additional receivable and reporting it as a cost would double-count it in
 * the wrong direction. Under `UNCONFIGURED` nobody has established which way it
 * goes, and guessing here is how the original D-041 error survived two years:
 * an unconfigured fee is reported as unresolved, never as zero cost.
 */
export function panelFeeCost(facts: PanelFeeCostFacts): PanelFeeCost {
  const feeCents = toCents(facts.feeAmount);
  const treatment = facts.feeTreatment ?? 'UNCONFIGURED';

  if (feeCents === 0 || treatment !== 'WITHHELD_FROM_CLAIM') {
    return { costCents: 0, state: 'NOT_A_COST' };
  }
  if (facts.outstandingCents > 0) {
    return { costCents: feeCents, state: 'EXPECTED' };
  }
  // Settled. Did money actually arrive? A claim closed by a write-off cost the
  // clinic the whole claim, not a fee — counting a fee there would inflate the
  // fee bill with money no panel ever kept.
  const receivedCents = toCents(facts.receivedAmount ?? 0);
  return receivedCents > 0 ? { costCents: feeCents, state: 'BORNE' } : { costCents: 0, state: 'NOT_BORNE' };
}

export interface PanelFeeCostRollUp {
  /** Fees on claims that settled with money. Spent. */
  borneCents: number;
  /** Fees on claims still outstanding. Will be spent when they pay. */
  expectedCents: number;
  /**
   * Claims carrying a fee whose direction nobody has configured. Their fee is
   * in NEITHER total above, and a non-zero count means both are understated.
   */
  unresolvedCount: number;
  unresolvedFeeCents: number;
}

export function rollUpPanelFeeCost(claims: PanelFeeCostFacts[]): PanelFeeCostRollUp {
  const roll: PanelFeeCostRollUp = {
    borneCents: 0,
    expectedCents: 0,
    unresolvedCount: 0,
    unresolvedFeeCents: 0,
  };
  for (const claim of claims) {
    const feeCents = toCents(claim.feeAmount);
    if (feeCents > 0 && (claim.feeTreatment ?? 'UNCONFIGURED') === 'UNCONFIGURED') {
      roll.unresolvedCount += 1;
      roll.unresolvedFeeCents += feeCents;
      continue;
    }
    const cost = panelFeeCost(claim);
    if (cost.state === 'BORNE') roll.borneCents += cost.costCents;
    else if (cost.state === 'EXPECTED') roll.expectedCents += cost.costCents;
  }
  return roll;
}

// ---------------------------------------------------------------------------
// 3 · WAS THE FEE ACTUALLY TAKEN?
//
// The owner's instruction on the two full-amount exceptions in the workbook
// (§4.1a) was to INVESTIGATE them rather than average them away: fee waived,
// zero fee in that transaction, manual exception, settlement adjustment, or a
// data-quality problem. That investigation was a forensic pass over 2,640 rows.
// Kuwick should find them by itself, every month, without anybody looking.
//
// The evidence is the money, not the paperwork. A remittance can be keyed two
// equally correct ways — gross RM100 with RM8 withheld, or gross RM92 with
// nothing withheld — so the `withheldAmount` field cannot be the test. What
// settles it is what the claim RECEIVED against what it EXPECTED.
// ---------------------------------------------------------------------------

export type FeeEvidenceState =
  /** Settled at exactly claimed − fee. The fee was taken, as configured. */
  | 'TAKEN'
  /**
   * Settled for MORE than claimed − fee. The panel did not deduct the fee, or
   * deducted less of it. This is the shape of the workbook's two exceptions.
   */
  | 'NOT_TAKEN'
  /** Settled for more than the whole claim. A different question entirely. */
  | 'OVERPAID'
  /** Still owed. Nothing has happened yet to be evidence of anything. */
  | 'PENDING'
  /**
   * The claim closed without money — rejected outright, or written off. No fee
   * was withheld because nothing was remitted, so there is nothing to test.
   * Distinguished from PENDING because a rejected claim is not "waiting".
   */
  | 'NOT_PAID'
  /**
   * Settled for LESS than expected — part-approved, short-paid, or partly
   * written off. Whether the shortfall is the fee or the rejection cannot be
   * told apart from these numbers, so Kuwick says so instead of picking one.
   */
  | 'INCONCLUSIVE'
  /** No withheld fee to have taken. */
  | 'NOT_APPLICABLE';

export interface FeeEvidenceFacts {
  feeAmount: MoneyLike;
  feeTreatment?: ClaimFeeTreatment | null;
  claimedCents: number;
  expectedReceivableCents: number;
  receivedCents: number;
  outstandingCents: number;
}

export interface FeeEvidence {
  state: FeeEvidenceState;
  /**
   * How far the settlement sits from where the fee rule says it should —
   * `NOT_TAKEN` measures it from the expected receivable, `OVERPAID` from the
   * full claim. Zero for every other state.
   */
  differenceCents: number;
}

export function feeEvidence(facts: FeeEvidenceFacts): FeeEvidence {
  const feeCents = toCents(facts.feeAmount);
  if (feeCents === 0 || (facts.feeTreatment ?? 'UNCONFIGURED') !== 'WITHHELD_FROM_CLAIM') {
    return { state: 'NOT_APPLICABLE', differenceCents: 0 };
  }
  if (facts.outstandingCents > 0) {
    return { state: 'PENDING', differenceCents: 0 };
  }
  if (facts.receivedCents === 0) {
    return { state: 'NOT_PAID', differenceCents: 0 };
  }
  if (facts.receivedCents > facts.claimedCents) {
    return { state: 'OVERPAID', differenceCents: facts.receivedCents - facts.claimedCents };
  }
  if (facts.receivedCents > facts.expectedReceivableCents) {
    return { state: 'NOT_TAKEN', differenceCents: facts.receivedCents - facts.expectedReceivableCents };
  }
  if (facts.receivedCents < facts.expectedReceivableCents) {
    return { state: 'INCONCLUSIVE', differenceCents: 0 };
  }
  return { state: 'TAKEN', differenceCents: 0 };
}

// ---------------------------------------------------------------------------
// 4 · DID THEY KEEP MORE THAN THE FEE?
//
// Separate from §3, and only askable of a remittance that RECORDS a
// withholding. A remittance keyed as "gross 92, withheld 0, net 92" is not
// evidence that no fee was taken — it is a remittance keyed net. Treating it
// as a finding would flag every correctly-entered payment in the system, and a
// check that cries wolf is a check nobody reads.
// ---------------------------------------------------------------------------

export interface WithholdingFacts {
  /** What the remittance advice says the panel kept. */
  withheldAmount: MoneyLike;
  /** The withheld fees on the claims this remittance settled, summed. */
  expectedFeeCents: number;
}

export interface WithholdingReconciliation {
  /**
   * FALSE when the remittance records no withholding at all, in which case
   * every figure below is zero and there is nothing to answer for.
   */
  applicable: boolean;
  withheldCents: number;
  expectedFeeCents: number;
  /** Withholding the configured fees account for. */
  explainedCents: number;
  /** Kept beyond the fees. A deduction nobody has accounted for. */
  unexplainedCents: number;
  agrees: boolean;
}

export function reconcileWithholding(facts: WithholdingFacts): WithholdingReconciliation {
  const withheldCents = toCents(facts.withheldAmount);
  if (withheldCents === 0) {
    return {
      applicable: false,
      withheldCents: 0,
      expectedFeeCents: facts.expectedFeeCents,
      explainedCents: 0,
      unexplainedCents: 0,
      agrees: true,
    };
  }
  const explainedCents = Math.min(withheldCents, facts.expectedFeeCents);
  return {
    applicable: true,
    withheldCents,
    expectedFeeCents: facts.expectedFeeCents,
    explainedCents,
    unexplainedCents: clampAtZero(withheldCents - facts.expectedFeeCents),
    agrees: withheldCents === facts.expectedFeeCents,
  };
}
