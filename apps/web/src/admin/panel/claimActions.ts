import type { PanelClaimStatus } from '../types';

/**
 * WHICH DECISIONS A CLAIM IS STILL OPEN TO.
 *
 * Pulled out of the workspace's row renderer because it is a RULE, and a rule
 * buried in a ternary inside a table column is a rule nobody can test and
 * nobody notices is wrong. This one was: `RESUBMISSION_REQUIRED` — the status
 * whose whole meaning is "rejected, with a route back: re-claim under a new
 * number" — was missing from the re-claim condition, so such a claim appeared
 * on the work queue flagged as needing a re-claim, with no button to make one.
 */

/** A claim can be re-claimed once, and only from a state that lost money. */
export function canReclaim(row: { status: PanelClaimStatus; replacement?: unknown }): boolean {
  if (row.replacement) return false; // already re-claimed; a second one double-counts
  return row.status === 'REJECTED' || row.status === 'PARTIALLY_APPROVED' || row.status === 'RESUBMISSION_REQUIRED';
}

/** Writing off is about MONEY STILL OUT, not about the claim's status. */
export function canWriteOff(row: { outstanding: number }): boolean {
  return row.outstanding > 0;
}

/** The panel's answer is recorded once; after that the claim is adjudicated. */
export function canRecordOutcome(row: { approvedAmount: number | null }): boolean {
  return row.approvedAmount === null;
}

/**
 * THE PANEL REFUSED, SO THE PATIENT PAYS (G-5).
 *
 * A distinct decision from a write-off and it must read that way on the row: a
 * write-off says the money is gone, this says it is coming from somebody else.
 * Offered only where the panel has actually refused something, and only once —
 * charging the same rejection to a patient twice is the kind of mistake that
 * ends in an argument at the counter.
 */
export function canChargeToPatient(row: {
  status: PanelClaimStatus;
  rejectedAmount: number | null;
  chargedToPatient?: number | null;
}): boolean {
  if (row.chargedToPatient) return false;
  if (!row.rejectedAmount || row.rejectedAmount <= 0) return false;
  return row.status === 'REJECTED' || row.status === 'PARTIALLY_APPROVED' || row.status === 'RESUBMISSION_REQUIRED';
}
